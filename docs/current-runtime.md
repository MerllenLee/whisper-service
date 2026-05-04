# 目前運作狀態

這份文件記錄目前部署在 `wez-dgxspark-01` 上的實際運作狀態，供協力者更新程式後對照。

## Kubernetes 命名空間

- Namespace：`whisper`
- Ingress host：`whisper.wezoomtek.com.tw`
- API health：`https://whisper.wezoomtek.com.tw/api/health`

## GPU 共享狀態

GB10 GPU 目前透過 NVIDIA device plugin 的 time-slicing 共享。

- `nvidia.com/gpu.replicas=2`
- API 會 request 1 個 GPU slot。
- LLM 會 request 1 個 GPU slot。
- 沒有使用 MIG。

time-slicing 的 ConfigMap 有納入版本控管：

- `k8s/time-slicing-config-gb10.yaml`

## API 部署

部署檔：

- `k8s/deployment.yaml`
- Kubernetes deployment：`whisper/api`
- Replicas：`1`
- Rollout strategy：`maxSurge: 0`、`maxUnavailable: 1`

API image 目前是節點本機 image，不預期從 registry pull：

- Image：`10.1.1.29:5000/whisper-api:transformers-gpu-app-fp16-input-fix`
- `imagePullPolicy: Never`

正式 rollout 前，這個 image 必須已經存在於 GPU 節點的 k3s/containerd image store。

目前 ASR 語音轉文字設定：

- `ASR_BACKEND=transformers`
- `STREAM_MODEL=openai/whisper-small`
- `DEVICE=auto`
- `COMPUTE_TYPE=float16`
- GPU resource：`nvidia.com/gpu: 1`

ASR 目前使用 PyTorch/Transformers 在 CUDA 上以 fp16 執行。

目前 embedding/RAG 檢索設定：

- Embedding model：`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
- `EMBEDDING_DEVICE=cpu`
- Vector store：本機 ChromaDB collections，由 `api/data/*.json` 自動重建

`EMBEDDING_DEVICE=cpu` 是刻意設定，避免 embedding 和 ASR、LLM 競爭 GPU memory。

## LLM 部署

部署檔：

- `k8s/llm-deployment.yaml`
- Kubernetes deployment：`whisper/llm`
- Image：`whisper-llm:v202604291509`
- `imagePullPolicy: Never`

目前文字生成模型：

- `LLM_MODEL=bg-digitalservices/Gemma-4-E2B-NVFP4`

LLM runtime：

- vLLM OpenAI-compatible API，port `8001`
- `--quantization modelopt`
- `--dtype auto`
- `--kv-cache-dtype fp8`
- `--gpu-memory-utilization 0.4`
- `--max-model-len 131072`
- `--chat-template-content-format string`

LLM 會使用 1 個 GPU slot：

- `nvidia.com/gpu: 1`

## 模型品質調整方向

如果 ASR 語音辨識品質不好，優先調整或替換 API 的 ASR 模型：

- 目前模型：`openai/whisper-small`
- 先前正式 ASR 模型：`phate334/Breeze-ASR-25-ct2`，透過 faster-whisper/CTranslate2 在 CPU 上執行
- 後續候選：原始 PyTorch/Transformers 版本的 Breeze ASR，但需要先驗證 GPU runtime 相容性

如果產出的評鑑意見品質不好，建議依序檢查：

1. `api/app/llm_client.py` 的 prompt 組裝
2. MiniLM + ChromaDB 的 RAG 檢索結果是否相關
3. `k8s/llm-deployment.yaml` 裡的 vLLM chat template
4. LLM 模型本身：`bg-digitalservices/Gemma-4-E2B-NVFP4`

## 本機 image 匯入流程

因為 GPU API image 很大，內部 registry 空間有限，目前採用節點本機 k3s/containerd image 部署。

建置 image：

```bash
docker build -f api/Dockerfile.transformers-gpu \
  -t 10.1.1.29:5000/whisper-api:transformers-gpu-app-fp16-input-fix .
```

匯出 image tar：

```bash
docker save -o /tmp/whisper-api-transformers-gpu-app-fp16-input-fix.tar \
  10.1.1.29:5000/whisper-api:transformers-gpu-app-fp16-input-fix
```

在 `wez-dgxspark-01` 匯入 k3s/containerd：

```bash
sudo k3s ctr images import /tmp/whisper-api-transformers-gpu-app-fp16-input-fix.tar
```

套用 deployment：

```bash
kubectl apply -f k8s/deployment.yaml
kubectl rollout status -n whisper deployment/api
```

驗證：

```bash
kubectl get deploy,pod -n whisper -o wide
kubectl exec -n whisper deploy/api -- python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health').read().decode())"
```
