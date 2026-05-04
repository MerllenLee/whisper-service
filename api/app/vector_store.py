"""向量資料庫封裝：評鑑指標 + 歷年委員意見的 embedding 儲存與語意搜尋。

設計原則：
- ChromaDB persistent client 本地持久化，不依賴外部服務
- SentenceTransformer 繁中 embedding，純 CPU 可用
- manifest.json 版本管理：來源 JSON mtime 有變動時自動重建 collection
- 執行緒安全單例（double-checked locking）

Collections：
- "indicators"：評鑑指標，metadata 含 year / type_key / code / 指標種類
- "fewshot"：歷年委員意見，metadata 含 code / 類型 / 年度
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

from app.config import EMBEDDING_DEVICE

logger = logging.getLogger(__name__)

# ── 常數 ────────────────────────────────────────────────────────────────────

_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
_INDICATORS_COLLECTION = "indicators"
_FEWSHOT_COLLECTION = "fewshot"
_MANIFEST_FILE = "manifest.json"

# ── 單例 ─────────────────────────────────────────────────────────────────────

_instance: VectorStore | None = None
_lock = threading.Lock()


def get_vector_store() -> "VectorStore":
    """回傳全域 VectorStore 單例（double-checked locking）。"""
    global _instance
    if _instance is None:
        with _lock:
            if _instance is None:
                data_dir = Path(__file__).parent.parent / "data"
                persist_dir = Path(__file__).parent.parent / "data" / "chroma"
                _instance = VectorStore(data_dir=data_dir, persist_dir=persist_dir)
    return _instance


# ── 核心類別 ──────────────────────────────────────────────────────────────────

class VectorStore:
    """評鑑指標與歷年意見的向量資料庫。

    Args:
        data_dir: 含 indicators.json / fewshot.json 的目錄。
        persist_dir: ChromaDB 持久化目錄（自動建立）。

    Raises:
        FileNotFoundError: indicators.json 或 fewshot.json 不存在時。
        ImportError: chromadb 或 sentence_transformers 未安裝時。
    """

    def __init__(self, data_dir: Path, persist_dir: Path) -> None:
        self._data_dir = data_dir
        self._persist_dir = persist_dir

        # 驗證來源檔案存在（啟動時即報錯，不等到 API 呼叫）
        self._indicators_path = data_dir / "indicators.json"
        self._fewshot_path = data_dir / "fewshot.json"
        self._validate_source_files()

        # 載入原始資料（供指標精確查詢用）
        self._indicators: dict[str, Any] = json.loads(
            self._indicators_path.read_text(encoding="utf-8")
        )
        self._fewshot: dict[str, list] = json.loads(
            self._fewshot_path.read_text(encoding="utf-8")
        )

        # 初始化 embedding 模型
        logger.info("載入 embedding 模型: %s device=%s", _EMBEDDING_MODEL, EMBEDDING_DEVICE)
        from sentence_transformers import SentenceTransformer
        self._model = SentenceTransformer(_EMBEDDING_MODEL, device=EMBEDDING_DEVICE)

        # 初始化 ChromaDB
        import chromadb
        persist_dir.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=str(persist_dir),
            settings=chromadb.Settings(anonymized_telemetry=False),
        )

        # 版本管理：依 mtime 決定是否重建
        if self._needs_rebuild():
            logger.info("來源資料已更新，重建向量索引...")
            self._rebuild_collections()
            self._write_manifest()
        else:
            logger.info("向量索引已是最新，跳過重建")

        logger.info(
            "VectorStore 就緒｜指標 %d 條｜few-shot %d 筆",
            len(self._indicators),
            sum(len(v) for v in self._fewshot.values()),
        )

    # ── 公開查詢介面 ──────────────────────────────────────────────────────────

    def get_indicator(self, year: int, type_key: str, code: str) -> dict | None:
        """精確查詢單一指標，找不到時依序 fallback。

        Fallback 順序：
          1. 當年度 + 指定機構種類
          2. 當年度 + 機構住宿式
          3. 114年 + 機構住宿式

        Returns:
            指標 dict 或 None（所有 fallback 都找不到時）。
        """
        candidates = [
            f"{year}_{type_key}_{code}",
            f"{year}_機構住宿式_{code}",
            f"114_機構住宿式_{code}",
        ]
        for key in candidates:
            if indicator := self._indicators.get(key):
                if key != candidates[0]:
                    logger.warning("指標 %s 不存在，使用 fallback: %s", candidates[0], key)
                return indicator
        logger.error("找不到指標 %s（含所有 fallback）", candidates[0])
        return None

    def get_fewshot(self, code: str, query: str, n: int = 3) -> list[dict]:
        """以語意相似度搜尋與 query 最接近的 n 筆 few-shot 意見。

        先以 metadata code 過濾，再對候選集做向量相似度排序。
        若該代碼無歷年資料，回傳空清單。

        Args:
            code: 指標代碼，例如 A1。
            query: 委員觀察紀錄（transcript），用於相似度比對。
            n: 回傳筆數。

        Returns:
            list of {"類型": str, "意見": str, "年度": int}
        """
        candidates = self._fewshot.get(code, [])
        if not candidates:
            return []

        collection = self._client.get_collection(_FEWSHOT_COLLECTION)
        query_embedding = self._model.encode(query).tolist()

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=min(n, len(candidates)),
            where={"code": code},
            include=["metadatas", "documents"],
        )

        output = []
        for meta in results["metadatas"][0]:
            output.append({
                "類型": meta["類型"],
                "意見": meta["意見"],
                "年度": meta["年度"],
            })
        return output

    # ── 內部方法 ──────────────────────────────────────────────────────────────

    def _validate_source_files(self) -> None:
        """確認來源 JSON 存在，否則 raise FileNotFoundError。"""
        missing = [
            p for p in (self._indicators_path, self._fewshot_path)
            if not p.exists()
        ]
        if missing:
            names = ", ".join(p.name for p in missing)
            raise FileNotFoundError(
                f"找不到評鑑資料檔案：{names}\n"
                f"請先執行：python3 -m app.data_preprocessor"
            )

    def _manifest_path(self) -> Path:
        return self._persist_dir / _MANIFEST_FILE

    def _current_mtimes(self) -> dict[str, float]:
        return {
            "indicators_mtime": self._indicators_path.stat().st_mtime,
            "fewshot_mtime": self._fewshot_path.stat().st_mtime,
            "model": _EMBEDDING_MODEL,
        }

    def _needs_rebuild(self) -> bool:
        """比對 manifest 與當前來源檔案 mtime，決定是否需要重建。"""
        manifest_path = self._manifest_path()
        if not manifest_path.exists():
            return True
        try:
            saved = json.loads(manifest_path.read_text(encoding="utf-8"))
            current = self._current_mtimes()
            return saved != current
        except (json.JSONDecodeError, KeyError, OSError):
            return True

    def _write_manifest(self) -> None:
        manifest_path = self._manifest_path()
        manifest_path.write_text(
            json.dumps(self._current_mtimes(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _rebuild_collections(self) -> None:
        """刪除並重建兩個 collection，批次 embed 所有資料。"""
        self._rebuild_indicators_collection()
        self._rebuild_fewshot_collection()

    def _rebuild_indicators_collection(self) -> None:
        """重建 indicators collection。embed 欄位 = 指標內容。"""
        # 刪除舊 collection（若存在）
        try:
            self._client.delete_collection(_INDICATORS_COLLECTION)
        except Exception:
            pass

        collection = self._client.create_collection(
            name=_INDICATORS_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )

        items = list(self._indicators.items())
        if not items:
            return

        ids, texts, metadatas = [], [], []
        for key, item in items:
            ids.append(key)
            texts.append(item.get("指標內容", ""))
            metadatas.append({
                "year": item.get("年度", 0),
                "type_key": item.get("機構種類", ""),
                "code": item.get("代碼", ""),
                "指標種類": item.get("指標種類", ""),
            })

        logger.info("Embedding %d 條指標...", len(texts))
        embeddings = self._model.encode(texts, batch_size=64, show_progress_bar=False)
        collection.add(
            ids=ids,
            embeddings=embeddings.tolist(),
            documents=texts,
            metadatas=metadatas,
        )
        logger.info("indicators collection 建立完成")

    def _rebuild_fewshot_collection(self) -> None:
        """重建 fewshot collection。embed 欄位 = 意見內容。"""
        try:
            self._client.delete_collection(_FEWSHOT_COLLECTION)
        except Exception:
            pass

        collection = self._client.create_collection(
            name=_FEWSHOT_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )

        ids, texts, metadatas = [], [], []
        for code, examples in self._fewshot.items():
            for idx, ex in enumerate(examples):
                ids.append(f"{code}_{idx}")
                texts.append(ex.get("意見", ""))
                metadatas.append({
                    "code": code,
                    "類型": ex.get("類型", ""),
                    "意見": ex.get("意見", ""),
                    "年度": ex.get("年度", 0),
                })

        if not texts:
            return

        logger.info("Embedding %d 筆 few-shot 意見...", len(texts))
        embeddings = self._model.encode(texts, batch_size=64, show_progress_bar=False)
        collection.add(
            ids=ids,
            embeddings=embeddings.tolist(),
            documents=texts,
            metadatas=metadatas,
        )
        logger.info("fewshot collection 建立完成")
