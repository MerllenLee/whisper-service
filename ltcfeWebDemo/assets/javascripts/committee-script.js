// ========== 全域變數 ==========
let currentItemIndex = 0;
let currentGroupIndex = 0;

// 錄音狀態：key = textarea id（memo_0, opinion_0, ...）
// activeTextareaId：目前正在錄音的 textarea id（同時只允許一個麥克風）
let activeTextareaId = null;
const micStates = {}; // id → { mediaStream, source, processor, timer }

// 錄音狀態管理（updateNetworkIndicator 殘留引用，新架構已改用 micStates / activeTextareaId）
const recordingStates = {
    1: { isRecording: false, startTime: null, timer: null },
    2: { isRecording: false, startTime: null, timer: null },
    3: { isRecording: false, startTime: null, timer: null }
};

// 照片管理（每個組別獨立）
const photoData = {
    1: [],
    2: [],
    3: []
};

// 當前相機操作的組別
let currentCameraGroup = null;

// 評鑑項目資料
const evaluationItems = [
    {
        code: 'A1',
        title: '業務計畫擬訂與執行',
        description: '依據機構發展方向，訂定年度業務計畫，計畫應有目標及執行內容。'
    },
    {
        code: 'A3',
        title: '工作手冊制定與執行情形',
        description: '機構應有明確的組織架構及管理制度，並確實執行。'
    },
    {
        code: 'A4',
        title: '行政會議辦理情形',
        description: '機構應有完善的人力資源管理制度，包含招募、訓練、考核等。'
    }
];

// 追蹤每個項目的每組完成狀態
const allItemsStatus = {
    0: { 1: false, 2: false, 3: false }, // A1
    1: { 1: false, 2: false, 3: false }, // A3
    2: { 1: false, 2: false, 3: false }  // A3
};

// 當前項目的組別狀態（為了兼容現有代碼）
const groupStatus = {
    1: false,
    2: false,
    3: false
};



// 更新評鑑項目內容
function updateItemContent() {
    const item = evaluationItems[currentItemIndex];

    // 更新代碼
    // document.querySelector('.code-badge').textContent = item.code;

    // 更新共通基準
    // document.querySelectorAll('.info-value')[1].textContent = item.title;

    // 更新所有組別的基準說明
    // document.querySelectorAll('.criterion-description .description-text').forEach(desc => {
    //     desc.textContent = item.description;
    // });

    // 更新頁面進度
    const progressText = document.querySelector('.progress-text');
    progressText.textContent = `項目 ${currentItemIndex + 1} / ${evaluationItems.length}`;

    // 更新進度條
    const progressPercentage = ((currentItemIndex + 1) / evaluationItems.length) * 100;
    document.querySelector('.progress-fill').style.width = progressPercentage + '%';

    // 載入當前項目的組別完成狀態
    groupStatus[1] = allItemsStatus[currentItemIndex][1];
    groupStatus[2] = allItemsStatus[currentItemIndex][2];
    groupStatus[3] = allItemsStatus[currentItemIndex][3];

    // 恢復評分選擇（如果有的話）
    for (let i = 1; i <= 3; i++) {
        const radios = document.querySelectorAll(`input[name="rating${i}"]`);
        radios.forEach(radio => {
            radio.checked = false; // 先清除
        });
    }

    // 停止所有錄音
    // for (let i = 1; i <= 3; i++) {
    //     if (recordingStates[i].isRecording) {
    //         stopRecording(i);
    //     }
    // }

    // 清除所有評分選擇
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.checked = false;
    });

    // 清除所有意見
    for (let i = 1; i <= 3; i++) {
        const textarea = document.getElementById(`comment${i}`);
        if (textarea) {
            textarea.value = '';
            // 重置高度
            autoResizeTextarea(textarea);
        }
    }

    // 清除所有照片
    // for (let i = 1; i <= 3; i++) {
    //     photoData[i] = [];
    //     updatePhotoGrid(i);
    // }

    // 重置當前組別索引
    currentGroupIndex = 0;

    // 更新項目進度條
    updateItemProgress();

    // 更新快速選單狀態
    updateQuickMenuState();

    // 關閉所有手風琴，然後展開第一題
    const headers = document.querySelectorAll('.accordion-header');
    const contents = document.querySelectorAll('.accordion-content');
    const icons = document.querySelectorAll('.accordion-icon');

    headers.forEach((header, i) => {
        header.classList.remove('active');
        contents[i].classList.remove('active');
        icons[i].classList.remove('active');
    });

    headers[0].classList.add('active');
    contents[0].classList.add('active');
    icons[0].classList.add('active');

    // 滾動到頁面頂部
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// 更新評鑑項目進度
function updateItemProgress() {
    const completedCount = Object.values(groupStatus).filter(status => status).length;
    const progressPercentage = (completedCount / 3) * 100;

    // 更新進度條
    // document.getElementById('itemProgressFill').style.width = progressPercentage + '%';
    // document.getElementById('currentGroup').textContent = completedCount;

}

// 找到當前活躍的組別（第一個未完成的組別）
function findCurrentActiveGroup() {
    for (let i = 1; i <= 3; i++) {
        if (!groupStatus[i]) {
            return i;
        }
    }
    return 3; // 如果都完成了，返回最後一組
}

// 檢查組別是否完成
function checkGroupCompletion(groupNumber) {
    const ratingName = 'rating' + groupNumber;
    const rating = document.querySelector(`input[name="${ratingName}"]:checked`);
    const isCompleted = rating !== null;

    // 更新當前項目的組別狀態
    groupStatus[groupNumber] = isCompleted;

    // 更新全局狀態
    allItemsStatus[currentItemIndex][groupNumber] = isCompleted;

    updateItemProgress();
    updateQuickMenuState();
}

// ========== 折疊標準區域功能 ==========
function toggleStandards(groupNum) {
    const content = document.getElementById(`standards${groupNum}`);
    const button = content.previousElementSibling;

    if (content.classList.contains('show')) {
        // 關閉
        content.classList.remove('show');
        button.classList.remove('active');
    } else {
        // 開啟
        content.classList.add('show');
        button.classList.add('active');
    }
}

// 折疊前次委員意見
function togglePreviousComment(groupNum) {
    const content = document.getElementById(`previousComment${groupNum}`);
    const button = content.previousElementSibling;

    if (content.classList.contains('show')) {
        // 關閉
        content.classList.remove('show');
        button.classList.remove('active');
    } else {
        // 開啟
        content.classList.add('show');
        button.classList.add('active');
    }
}

// 手風琴功能
function toggleAccordion(index) {
    const items = document.querySelectorAll('.accordion-item');
    const headers = document.querySelectorAll('.accordion-header');
    const contents = document.querySelectorAll('.accordion-content');
    const icons = document.querySelectorAll('.accordion-icon');

    // 檢查當前項目是否已經展開
    const isCurrentlyActive = headers[index].classList.contains('active');

    // 關閉所有其他項目
    items.forEach((item, i) => {
        if (i !== index) {
            headers[i].classList.remove('active');
            contents[i].classList.remove('active');
            icons[i].classList.remove('active');
        }
    });

    // 切換當前項目
    if (isCurrentlyActive) {
        // 如果已經展開，則關閉
        headers[index].classList.remove('active');
        contents[index].classList.remove('active');
        icons[index].classList.remove('active');
    } else {
        // 如果是關閉狀態，則展開並滾動到基準說明的位置
        headers[index].classList.add('active');
        contents[index].classList.add('active');
        icons[index].classList.add('active');

        // 更新當前組別索引
        currentGroupIndex = index;

        // 更新快速選單狀態
        updateQuickMenuState();

        // 滾動到該組別的基準說明位置 .criterion-description (80)
        // stan: 改到內容區塊起始處 .accordion-body(60)
        setTimeout(() => {
            const criterionDescription = items[index].querySelector('.accordion-body');
            if (criterionDescription) {
                const headerOffset = 60; // 距離頂部的偏移量
                const elementPosition = criterionDescription.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        }, 450); // 增加延遲時間以確保展開動畫完成
    }
}

// 組別導航功能
function navigateToGroup(groupIndex) {
    currentGroupIndex = groupIndex;

    const headers = document.querySelectorAll('.accordion-header');
    const contents = document.querySelectorAll('.accordion-content');
    const icons = document.querySelectorAll('.accordion-icon');
    const items = document.querySelectorAll('.accordion-item');

    // 關閉所有組別
    headers.forEach((header, i) => {
        header.classList.remove('active');
        contents[i].classList.remove('active');
        icons[i].classList.remove('active');
    });

    // 展開目標組別
    headers[groupIndex].classList.add('active');
    contents[groupIndex].classList.add('active');
    icons[groupIndex].classList.add('active');

    // 更新快速選單狀態
    updateQuickMenuState();

    // 等待展開動畫完全完成後再滾動
    // 滾動到該組別的基準說明位置 .criterion-description (80)
    // stan: 改到內容區塊起始處 .accordion-body(60)
    setTimeout(() => {
        const criterionDescription = items[groupIndex].querySelector('.accordion-body');
        if (criterionDescription) {
            const headerOffset = 60;
            const elementPosition = criterionDescription.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    }, 450); // 增加延遲時間以確保動畫完成
}

// 頁面載入時預設展開第一題
window.addEventListener('DOMContentLoaded', function () {
    toggleAccordion(0);
    updateItemProgress();
    updateItemContent();
    updateQuickMenuState();
    bindVoiceButtons();

    // 自動連線 WebSocket
    const wsInput = document.getElementById('wsUrlInput');
    if (wsInput && !wsInput.value.trim()) {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsInput.value = `${wsProtocol}//${window.location.host}/api/stream`;
    }
    wsConnect();
});

// 綁定所有麥克風按鈕與 AI 按鈕
function bindVoiceButtons() {
    // 麥克風按鈕
    document.querySelectorAll('.btn-microphone[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.dataset.target;
            toggleMic(targetId);
        });
    });
    // AI 產製按鈕
    document.querySelectorAll('.btn-ai[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            generateAiReport(btn.dataset.memo, btn.dataset.opinion, btn.dataset.target);
        });
    });
}

// ========== 初始化設置 ==========

/*function updateAllNetworkIndicators(isOnline) {
    for (let i = 1; i <= 3; i++) {
        updateNetworkIndicator(i, isOnline);
    }
}*/

function updateNetworkIndicator(groupNum, isOnline) {
    const indicator = document.getElementById(`networkStatus${groupNum}`);
    const dot = indicator.querySelector('.network-dot');
    const text = indicator.querySelector('span');

    if (isOnline) {
        indicator.className = 'network-indicator online';
        dot.classList.add('pulse');
        text.textContent = '網路已連接';
    } else {
        indicator.className = 'network-indicator offline';
        dot.classList.remove('pulse');
        text.textContent = '無網路連接';
    }

    // 更新錄音按鈕狀態
    const btn = document.getElementById(`voiceBtn${groupNum}`);
    if (!recordingStates[groupNum].isRecording) {
        btn.disabled = !isOnline;
    }
}

// ========== WebSocket 管理 ==========
let ws = null;
let wsConnected = false;
let sharedAudioContext = null;
// 轉錄結果 timer（避免 processing 訊息殘留）
let processingTimer = null;

function toggleWsConnection() {
    if (wsConnected) { wsDisconnect(); } else { wsConnect(); }
}

function wsConnect() {
    const url = document.getElementById('wsUrlInput').value.trim();
    const btn = document.getElementById('wsConnectBtn');
    const bar = document.getElementById('networkStatusBar');
    const txt = document.getElementById('networkStatusText');
    btn.disabled = true;
    txt.textContent = '連線中...';
    bar.className = 'network-status-bar';
    try {
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
            wsConnected = true;
            bar.className = 'network-status-bar online';
            txt.textContent = '語音服務已連線';
            btn.textContent = '斷線';
            btn.disabled = false;
        };
        ws.onmessage = (ev) => {
            try { handleWsMessage(JSON.parse(ev.data)); } catch (e) { console.error('WS message parse error:', e); }
        };
        ws.onerror = () => {
            txt.textContent = '連線失敗';
            btn.disabled = false;
        };
        ws.onclose = () => {
            wsConnected = false;
            bar.className = 'network-status-bar offline';
            txt.textContent = '語音服務已斷線';
            btn.textContent = '連線';
            btn.disabled = false;
            // 停止任何進行中的錄音
            if (activeTextareaId) stopMic(activeTextareaId);
        };
    } catch (e) {
        txt.textContent = `連線失敗: ${e.message}`;
        btn.disabled = false;
    }
}

function wsDisconnect() {
    if (ws) { ws.close(); ws = null; }
}

function handleWsMessage(data) {
    if (!activeTextareaId) return;
    const textarea = document.getElementById(activeTextareaId);
    if (!textarea) return;

    switch (data.type) {
        case 'processing': {
            if (processingTimer) clearTimeout(processingTimer);
            // 在 textarea 旁邊的 label 更新狀態（找最近的 btn 更新 text）
            const btn = document.querySelector(`[data-target="${activeTextareaId}"]`);
            if (btn) {
                processingTimer = setTimeout(() => {
                    const div = btn.querySelector('.text');
                    if (div && btn.classList.contains('recording')) div.textContent = '轉錄中...';
                }, 0);
            }
            break;
        }
        case 'transcription': {
            if (processingTimer) { clearTimeout(processingTimer); processingTimer = null; }
            if (data.text && data.text.trim()) {
                const cur = textarea.value;
                textarea.value = cur + (cur ? ' ' : '') + data.text.trim();
                autoResizeTextarea(textarea);
            }
            // 恢復按鈕 label（直接從 activeTextareaId 判斷，避免依賴 DOM 結構）
            const btn2 = document.querySelector(`[data-target="${activeTextareaId}"]`);
            if (btn2) {
                const div = btn2.querySelector('.text');
                if (div) div.textContent = activeTextareaId.startsWith('memo') ? '備忘錄' : '主要意見';
            }
            break;
        }
        case 'error': {
            console.error('WS error:', data.message);
            break;
        }
    }
}

// ========== AudioWorklet PCM16 ==========
const WORKLET_CODE = `class PCM16Writer extends AudioWorkletProcessor {
  constructor(o){ super(); const p=(o&&o.processorOptions)||{}; this.targetRate=p.targetSampleRate||16000; this.frameMs=p.frameDurationMs||30; this.srcRate=sampleRate; this.ratio=this.srcRate/this.targetRate; this.accum=[]; this.samplesPerFrame=Math.round(this.targetRate*(this.frameMs/1000)); this.port.onmessage=(ev)=>{ if(ev.data&&ev.data.type==='flush') this.flush(); }; }
  ds(ch){ const n=Math.floor(ch.length/this.ratio),out=new Float32Array(n); let i=0,pos=0; while(i<n){ const idx=pos|0,fr=pos-idx,s0=ch[idx]||0,s1=ch[idx+1]||s0; out[i++]=s0+(s1-s0)*fr; pos+=this.ratio; } return out; }
  toI16(f){ const b=new ArrayBuffer(f.length*2),dv=new DataView(b); for(let i=0;i<f.length;i++){ let s=Math.max(-1,Math.min(1,f[i])); dv.setInt16(i*2,s<0?s*0x8000:s*0x7FFF,true); } return b; }
  emit(){ while(this.accum.length>=this.samplesPerFrame){ const frame=this.accum.splice(0,this.samplesPerFrame),b=this.toI16(Float32Array.from(frame)); this.port.postMessage(b,[b]); } }
  flush(){ if(!this.accum.length)return; const pad=new Float32Array(this.samplesPerFrame); pad.set(Float32Array.from(this.accum)); const b=this.toI16(pad); this.port.postMessage(b,[b]); this.accum=[]; }
  process(inputs){ const ch=(inputs[0]||[])[0]; if(!ch)return true; const ds=this.ds(ch); for(let i=0;i<ds.length;i++)this.accum.push(ds[i]); this.emit(); return true; }
}
registerProcessor('pcm16-writer',PCM16Writer);`;

async function ensureWorkletReady() {
    if (!sharedAudioContext) {
        sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!ensureWorkletReady._url) {
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
        ensureWorkletReady._url = URL.createObjectURL(blob);
        await sharedAudioContext.audioWorklet.addModule(ensureWorkletReady._url);
    }
    return sharedAudioContext;
}

// ========== 麥克風開關（綁定到 textarea） ==========
async function toggleMic(textareaId) {
    if (activeTextareaId === textareaId) {
        // 停止當前麥克風：stopMic 內部會將 activeTextareaId 清為 null
        stopMic(textareaId);
    } else {
        // 先快照舊 id、清除 activeTextareaId，再停止舊麥克風並啟動新的
        // 避免 stopMic 觸發的回調讀到錯誤的 activeTextareaId
        const prevId = activeTextareaId;
        if (prevId) {
            activeTextareaId = null;
            stopMic(prevId);
        }
        await startMic(textareaId);
    }
}

async function startMic(textareaId) {
    if (!wsConnected) {
        wsConnect();
        return;
    }
    try {
        const ctx = await ensureWorkletReady();
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        const source = ctx.createMediaStreamSource(stream);
        const processor = new AudioWorkletNode(ctx, 'pcm16-writer', {
            numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1,
            processorOptions: { targetSampleRate: 16000, frameDurationMs: 30 }
        });
        processor.port.onmessage = (ev) => {
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(ev.data);
        };
        source.connect(processor);

        const startTime = Date.now();
        const timer = setInterval(() => {
            const btn = document.querySelector(`[data-target="${textareaId}"]`);
            if (!btn) return;
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            const div = btn.querySelector('.text');
            if (div) div.textContent = `${m}:${s}`;
        }, 1000);

        micStates[textareaId] = { mediaStream: stream, source, processor, timer };
        activeTextareaId = textareaId;
        setMicBtnRecording(textareaId, true);
    } catch (e) {
        console.error('麥克風錯誤:', e);
        alert(`無法啟動麥克風: ${e.message}`);
    }
}

function stopMic(textareaId) {
    const s = micStates[textareaId];
    if (!s) return;
    try { s.source.disconnect(); } catch (_) {}
    try { s.processor.port.postMessage({ type: 'flush' }); s.processor.disconnect(); } catch (_) {}
    try { s.mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    clearInterval(s.timer);
    delete micStates[textareaId];
    if (activeTextareaId === textareaId) activeTextareaId = null;
    setMicBtnRecording(textareaId, false);
}

function setMicBtnRecording(textareaId, isRec) {
    const btn = document.querySelector(`[data-target="${textareaId}"]`);
    if (!btn) return;
    const icon = btn.querySelector('i');
    const div = btn.querySelector('.text');
    const label = textareaId.startsWith('memo') ? '備忘錄' : '主要意見';
    if (isRec) {
        btn.classList.add('recording');
        if (icon) { icon.className = 'fas fa-stop'; }
        if (div) div.textContent = '00:00';
    } else {
        btn.classList.remove('recording');
        if (icon) { icon.className = 'fas fa-microphone'; }
        if (div) div.textContent = label;
    }
}

// ========== AI 產製 ==========
const API_BASE = window.location.origin.replace(/^ws/, 'http');

function getFacilityInfo() {
    // 從機構基本資料 Modal 讀取機構種類
    const badges = document.querySelectorAll('.facility-info-badge');
    let facilityType = '機構住宿式';
    let facilitySubtype = null;
    for (const badge of badges) {
        const text = badge.textContent.trim();
        if (text === '綜合式' || text === '機構住宿式') {
            facilityType = text;
        } else if (['居家式', '社區式-日間照顧', '社區式-小規模多機能', '社區式-團體家屋', '機構住宿式'].includes(text)) {
            facilitySubtype = text;
        }
    }
    return { facilityType, facilitySubtype };
}

async function generateAiReport(memoId, opinionId, targetId) {
    const memo = (document.getElementById(memoId)?.value || '').trim();
    const opinion = (document.getElementById(opinionId)?.value || '').trim();
    const transcript = [memo, opinion].filter(Boolean).join('\n');
    if (!transcript) {
        alert('請先填寫備忘錄或主要意見後再產製 AI 報告');
        return;
    }
    const btn = document.querySelector(`[data-target="${targetId}"]`);
    const targetEl = document.getElementById(targetId);
    const indicatorCode = btn?.dataset.code || '';

    if (btn) {
        const div = btn.querySelector('.text');
        if (div) div.textContent = '產製中...';
        btn.style.pointerEvents = 'none';
    }
    try {
        const { facilityType, facilitySubtype } = getFacilityInfo();
        const resp = await fetch(`${API_BASE}/api/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript,
                indicator_code: indicatorCode,
                facility_type: facilityType,
                facility_subtype: facilitySubtype,
            })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (targetEl) {
            targetEl.value = data.opinion || '';
            autoResizeTextarea(targetEl);
        }
    } catch (e) {
        alert(`AI 產製失敗: ${e.message}`);
    } finally {
        if (btn) {
            const div = btn.querySelector('.text');
            if (div) div.textContent = 'AI產製';
            btn.style.pointerEvents = '';
        }
    }
}

// 舊錄音介面（toggleRecording / startRecording / stopRecording / startTimer / updateRecordingUI）已移除，由 startMic / stopMic / setMicBtnRecording 取代


// ========== 拍照功能 ==========
function openCamera(groupNum) {
    currentCameraGroup = groupNum;
    const modal = document.getElementById('cameraModal');
    modal.classList.add('active');

    // 阻止背景滾動
    document.body.style.overflow = 'hidden';
}

function closeCamera() {
    const modal = document.getElementById('cameraModal');
    modal.classList.remove('active');
    currentCameraGroup = null;

    // 恢復背景滾動
    document.body.style.overflow = '';
}

// function capturePhoto() {
//     if (!currentCameraGroup) return;
//
//     // 顯示閃光效果
//     const flash = document.getElementById('cameraFlash');
//     flash.classList.add('active');
//
//     setTimeout(() => {
//         flash.classList.remove('active');
//
//         // 生成展示用照片（使用 Canvas 生成彩色方塊）
//         const photo = generateDemoPhoto();
//
//         // 儲存照片
//         photoData[currentCameraGroup].push({
//             id: Date.now(),
//             data: photo,
//             timestamp: new Date().toLocaleString('zh-TW')
//         });
//
//         // 更新照片列表
//         updatePhotoGrid(currentCameraGroup);
//
//         // 關閉相機
//         closeCamera();
//
//     }, 100);
// }

function generateDemoPhoto() {
    // 創建 Canvas 生成展示用圖片
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');

    // 隨機漸層背景
    const colors = [
        ['#667eea', '#764ba2'],
        ['#f093fb', '#f5576c'],
        ['#4facfe', '#00f2fe'],
        ['#43e97b', '#38f9d7'],
        ['#fa709a', '#fee140'],
        ['#30cfd0', '#330867']
    ];

    const colorPair = colors[Math.floor(Math.random() * colors.length)];
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, colorPair[0]);
    gradient.addColorStop(1, colorPair[1]);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 添加文字
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📷', canvas.width / 2, canvas.height / 2 - 30);

    ctx.font = '16px Arial';
    ctx.fillText('展示照片', canvas.width / 2, canvas.height / 2 + 10);

    const now = new Date();
    ctx.font = '12px Arial';
    ctx.fillText(now.toLocaleTimeString('zh-TW'), canvas.width / 2, canvas.height / 2 + 35);

    // 轉換為 Data URL
    return canvas.toDataURL('image/png');
}

// function updatePhotoGrid(groupNum) {
//     const grid = document.getElementById(`photoGrid${groupNum}`);
//     const count = document.getElementById(`photoCount${groupNum}`);
//     const photos = photoData[groupNum];
//
//     // 更新數量
//     count.textContent = `${photos.length} 張`;
//
//     // 更新照片列表
//     if (photos.length === 0) {
//         grid.innerHTML = '<div class="photo-empty">尚未拍攝照片</div>';
//     } else {
//         grid.innerHTML = photos.map(photo => `
//                     <div class="photo-item" onclick="viewPhoto(${groupNum}, ${photo.id})">
//                         <img src="${photo.data}" alt="照片" class="photo-img">
//                         <button class="photo-delete-btn" onclick="deletePhoto(event, ${groupNum}, ${photo.id})" title="刪除照片">×</button>
//                     </div>
//                 `).join('');
//     }
// }

// function deletePhoto(event, groupNum, photoId) {
//     // 阻止事件冒泡
//     event.stopPropagation();
//
//     if (confirm('確定要刪除這張照片嗎？')) {
//         // 從陣列中移除
//         photoData[groupNum] = photoData[groupNum].filter(p => p.id !== photoId);
//
//         // 更新顯示
//         updatePhotoGrid(groupNum);
//     }
// }

function viewPhoto(groupNum, photoId) {
    const photo = photoData[groupNum].find(p => p.id === photoId);
    if (photo) {
        // 在新視窗中查看照片
        const win = window.open('', '_blank');
        win.document.write(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>查看照片</title>
                        <style>
                            body {
                                margin: 0;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                min-height: 100vh;
                                background-color: #000;
                                font-family: Arial, sans-serif;
                            }
                            img {
                                max-width: 90%;
                                max-height: 80vh;
                                box-shadow: 0 4px 20px rgba(255,255,255,0.2);
                            }
                            .info {
                                color: white;
                                margin-top: 20px;
                                text-align: center;
                            }
                            .close-btn {
                                margin-top: 20px;
                                padding: 10px 30px;
                                background-color: #4a90e2;
                                color: white;
                                border: none;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 16px;
                            }
                            .close-btn:hover {
                                background-color: #3a7bc8;
                            }
                        </style>
                    </head>
                    <body>
                        <img src="${photo.data}" alt="照片">
                        <div class="info">
                            <div>拍攝時間: ${photo.timestamp}</div>
                            <div>組別: 第${groupNum}組</div>
                        </div>
                        <button class="close-btn" onclick="window.close()">關閉</button>
                    </body>
                    </html>
                `);
    }
}

// ESC 鍵關閉相機
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        closeCamera();
    }
});

// ========== 原有功能 ==========

// 快速選單功能
function toggleQuickMenu() {
    const menu = document.getElementById('quickMenu');
    menu.classList.toggle('active');
}

// ========== 機構資料 Modal 功能 ==========
function toggleFacilityModal() {
    const modal = document.getElementById('facilityModal');
    modal.classList.toggle('active');

    // 阻止或恢復背景滾動
    if (modal.classList.contains('active')) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
}

// 點擊 Modal 背景關閉
document.addEventListener('click', function (event) {
    const modal = document.getElementById('facilityModal');
    if (event.target === modal) {
        toggleFacilityModal();
    }
});

// ESC 鍵關閉 Modal
document.addEventListener('keydown', function (event) {
    const modal = document.getElementById('facilityModal');
    if (event.key === 'Escape' && modal.classList.contains('active')) {
        toggleFacilityModal();
    }
});

// 切換選單項目展開/收合
function toggleMenuItem(itemIndex, event) {
    const menuItems = document.querySelectorAll('.menu-item');
    const header = menuItems[itemIndex].querySelector('.menu-item-header');
    const groups = menuItems[itemIndex].querySelector('.menu-item-groups');
    const arrow = menuItems[itemIndex].querySelector('.menu-item-arrow');

    // 切換當前項目
    const isExpanded = groups.classList.contains('expanded');

    if (isExpanded) {
        groups.classList.remove('expanded');
        arrow.classList.remove('expanded');
    } else {
        // 關閉所有其他項目
        document.querySelectorAll('.menu-item-groups').forEach(g => g.classList.remove('expanded'));
        document.querySelectorAll('.menu-item-arrow').forEach(a => a.classList.remove('expanded'));

        // 展開當前項目
        groups.classList.add('expanded');
        arrow.classList.add('expanded');
    }

    // 阻止事件冒泡
    event.stopPropagation();
}

// 跳轉到指定題目和組別
function jumpToItemAndGroup(itemIndex, groupIndex, event) {
    // 關閉快速選單
    document.getElementById('quickMenu').classList.remove('active');

    // 如果是不同的題目，先切換題目
    if (itemIndex !== currentItemIndex) {
        currentItemIndex = itemIndex;
        updateItemContent();
    }

    // 切換到指定組別
    currentGroupIndex = groupIndex;
    navigateToGroup(groupIndex);

    // 更新快速選單狀態
    updateQuickMenuState();

    // 阻止事件冒泡
    event.stopPropagation();
}

// 更新快速選單的狀態顯示
function updateQuickMenuState() {
    const menuItems = document.querySelectorAll('.menu-item');
    const allGroupItems = document.querySelectorAll('.group-item');

    // 清除所有當前狀態和完成狀態
    document.querySelectorAll('.menu-item-header').forEach(h => {
        h.classList.remove('current');
        h.classList.remove('item-completed');
    });
    allGroupItems.forEach(g => g.classList.remove('current'));

    // 檢查並標記所有已完成的項目
    evaluationItems.forEach((item, itemIndex) => {
        const isItemCompleted = allItemsStatus[itemIndex][1] &&
            allItemsStatus[itemIndex][2] &&
            allItemsStatus[itemIndex][3];

        if (isItemCompleted) {
            const header = menuItems[itemIndex].querySelector('.menu-item-header');
            header.classList.add('item-completed');
        }
    });

    // 標記當前項目（在完成標記之後，這樣 current 樣式會覆蓋）
    menuItems[currentItemIndex].querySelector('.menu-item-header').classList.add('current');

    // 標記當前組別
    const currentGroupItem = menuItems[currentItemIndex].querySelectorAll('.group-item')[currentGroupIndex];
    if (currentGroupItem) {
        currentGroupItem.classList.add('current');
    }

    // 標記已完成的組別
    allGroupItems.forEach(g => g.classList.remove('completed'));

    // 為所有項目的已完成組別添加標記
    evaluationItems.forEach((item, itemIndex) => {
        for (let i = 1; i <= 3; i++) {
            if (allItemsStatus[itemIndex][i]) {
                const groupItem = menuItems[itemIndex].querySelectorAll('.group-item')[i - 1];
                if (groupItem) {
                    groupItem.classList.add('completed');
                }
            }
        }
    });
}

// 點擊頁面其他地方關閉選單
document.addEventListener('click', function (event) {
    const menu = document.getElementById('quickMenu');
    const menuIcon = document.querySelector('.quick-nav-bar');

    if (!menu.contains(event.target) && !menuIcon.contains(event.target)) {
        menu.classList.remove('active');
    }
});

// 導航功能 - 上一題
function previousItem() {
    if (currentItemIndex > 0) {
        currentItemIndex--;
        updateItemContent();
    } else {
        alert('已經是第一題了');
    }
}

// 導航功能 - 下一題
function nextItem() {
    // 檢查所有組別的評分
    const ratings = ['rating1', 'rating2', 'rating3'];
    let allRated = true;

    ratings.forEach(name => {
        const rating = document.querySelector(`input[name="${name}"]:checked`);
        if (!rating) {
            allRated = false;
        }
    });

    if (!allRated) {
        alert('請完成所有組別的評分');
        return;
    }

    // 切換到下一題
    if (currentItemIndex < evaluationItems.length - 1) {
        currentItemIndex++;
        updateItemContent();
    } else {
        alert('已完成所有評鑑項目！');
    }
}

// ========== 登入/登出功能 ==========

// 登入狀態管理
let isLoggedIn = false;
let currentUser = null;

// 初始化登入狀態
function initAuthState() {
    // 檢查 localStorage 是否有記住的登入狀態
    const savedUser = localStorage.getItem('currentUser');
    const rememberMe = localStorage.getItem('rememberMe') === 'true';

    if (savedUser && rememberMe) {
        try {
            currentUser = JSON.parse(savedUser);
            isLoggedIn = true;
            updateAuthUI();
        } catch (e) {
            console.error('讀取登入狀態失敗，清除舊資料:', e);
            localStorage.removeItem('currentUser');
            localStorage.removeItem('rememberMe');
        }
    }
}

// 處理登入/登出按鈕點擊
function handleAuthAction() {
    if (isLoggedIn) {
        // 登出
        handleLogout();
    } else {
        // 顯示登入 modal
        const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
        loginModal.show();
    }
}

// 處理登入
function handleLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const rememberMe = document.getElementById('rememberMe').checked;

    // 驗證輸入
    if (!username || !password) {
        alert('請輸入帳號和密碼！');
        return;
    }

    // 簡單的示範驗證（實際應該呼叫後端 API）
    if (username === 'demo' && password === '1234') {
        // 登入成功
        currentUser = {
            username: username,
            displayName: '示範委員',
            loginTime: new Date().toLocaleString('zh-TW')
        };
        isLoggedIn = true;

        // 儲存登入狀態
        if (rememberMe) {
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            localStorage.setItem('rememberMe', 'true');
        }

        // 更新 UI
        updateAuthUI();

        // 關閉 modal
        const loginModal = bootstrap.Modal.getInstance(document.getElementById('loginModal'));
        loginModal.hide();

        // 清空表單
        document.getElementById('loginForm').reset();

        // 顯示歡迎訊息
        setTimeout(() => {
            alert(`歡迎，${currentUser.displayName}！\n登入時間：${currentUser.loginTime}`);
        }, 300);

    } else {
        // 登入失敗
        alert('帳號或密碼錯誤！\n\n請使用示範帳號：\n帳號：demo\n密碼：1234');
    }
}

// 處理登出
function handleLogout() {
    if (confirm('確定要登出嗎？')) {
        // 清除登入狀態
        isLoggedIn = false;
        currentUser = null;
        localStorage.removeItem('currentUser');
        localStorage.removeItem('rememberMe');

        // 更新 UI
        updateAuthUI();

        // 顯示登出訊息
        alert('已成功登出！');
    }
}

// 更新登入/登出 UI
function updateAuthUI() {
    const authBtn = document.getElementById('authBtn');
    const authBtnText = document.getElementById('authBtnText');
    const userName = document.getElementById('userName');
    const userIcon = document.getElementById('userIcon');

    if (isLoggedIn && currentUser) {
        // 已登入狀態
        authBtn.classList.remove('login-mode');
        authBtnText.textContent = '🔓 登出';
        userName.textContent = currentUser.displayName;
        userIcon.textContent = '👨‍⚕️';
    } else {
        // 未登入狀態
        authBtn.classList.add('login-mode');
        authBtnText.textContent = '🔐 登入';
        userName.textContent = '訪客';
        userIcon.textContent = '👤';
    }
}

// 頁面載入時初始化登入狀態
document.addEventListener('DOMContentLoaded', function () {
    initAuthState();
    updateQuickMenuState(); // 初始化快速選單狀態
});

// Enter 鍵登入
document.getElementById('loginForm').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleLogin();
    }
});

// ========== Textarea 自動調整高度功能 ==========

// 自動調整 textarea 高度的函數
function autoResizeTextarea(textarea) {
    // 重置高度以獲得正確的 scrollHeight
    textarea.style.height = 'auto';

    // 計算新高度
    const newHeight = Math.min(Math.max(textarea.scrollHeight, 120), 500);

    // 設置新高度
    textarea.style.height = newHeight + 'px';
}

// 為所有 textarea 添加自動調整高度功能
for (let i = 1; i <= 3; i++) {
    const textarea = document.getElementById(`comment${i}`);
    if (textarea) {
        // 監聽輸入事件
        textarea.addEventListener('input', function () {
            autoResizeTextarea(this);
        });

        // 監聽貼上事件
        textarea.addEventListener('paste', function () {
            setTimeout(() => {
                autoResizeTextarea(this);
            }, 0);
        });

        // 初始化高度
        autoResizeTextarea(textarea);
    }
}

// 自動儲存功能
for (let i = 1; i <= 3; i++) {
    const textarea = document.getElementById(`comment${i}`);
    if (textarea) {
        let saveTimer;
        textarea.addEventListener('input', function () {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                // TODO: 實作實際儲存邏輯（e.g. localStorage 或後端 API）
            }, 1000);
        });
    }
}

// 評分選擇提示並更新進度
document.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', function () {
        // 根據 radio name 判斷是哪一組
        const groupNumber = parseInt(this.name.replace('rating', ''), 10);
        checkGroupCompletion(groupNumber);
    });
});

// 頁面卸載時清理資源
window.addEventListener('beforeunload', () => {
    Object.keys(micStates).forEach(id => stopMic(id));
    wsDisconnect();
    try {
        if (ensureWorkletReady._url) URL.revokeObjectURL(ensureWorkletReady._url);
    } catch (_) {}
});
