// HTML
const status = document.getElementById('status');
const video = document.getElementById('webcam-video');
const canvas = document.getElementById('canvas');
const resultContainer = document.getElementById('result-container');
const legend = document.getElementById('legend');
const startCameraBtn = document.getElementById('start-camera-btn');
const captureBtn = document.getElementById('capture-btn');
const capturePreviewContainer = document.getElementById('capture-preview-container');
const recordedVideoPreview = document.getElementById('recorded-video-preview');
const saveVideoBtn = document.getElementById('save-video-btn');

const ctx = canvas.getContext('2d');

let model = null;
let resizeObserver = null;

// 캡처 관련 변수
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d');
let recordedVideoUrl = null;        // 녹화 완료 후 생성된 영상 URL을 저장할 변수
let savedFileExtension = 'mp4';     // 저장될 영상 파일의 확장자

// 탐지된 객체 클래스별 색상을 위한 팔레트 및 할당 관리
const colors = ['#FF3838', '#FF9D42', '#00C2FF', '#00D5A3', '#8B5CF6', '#EC4899', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA'];
const classColorMap = {};
let colorIndex = 0;

function updateStatus(text) {
    status.innerText = text;
}

// 웹페이지 로딩이 완료 후 초기화
document.addEventListener('DOMContentLoaded', () => {
    updateStatus('AI 모델을 로딩 중입니다...');
    startCameraBtn.disabled = true;

    cocoSsd.load().then(loadedModel => {
        model = loadedModel;
        updateStatus('카메라 시작 버튼을 눌러주세요.');
        startCameraBtn.disabled = false;
    }).catch(error => {
        console.error("모델 로딩 실패:", error);
        updateStatus('모델 로딩에 실패했습니다. 페이지를 새로고침 해주세요.');
    });
});

// 카메라 시작 함수
async function startCameraStream(constraints) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    startCameraBtn.classList.add('hidden');
    updateStatus('카메라를 로딩 중입니다...');
}

// '카메라 시작' 버튼 클릭 시 실행
startCameraBtn.addEventListener('click', async () => {
    if (!model) {
        updateStatus('모델이 아직 로드되지 않았습니다. 잠시만 기다려주세요.');
        return;
    }

    capturePreviewContainer.classList.add('hidden');

    // iOS Safari 감지 (userAgent로)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    try {
        // iOS에서는 일부 카메라 설정 옵션이 제한되므로 fallback 추가
        if (isIOS) {
            // iOS는 'facingMode' 대신 단순 video:true로 먼저 시도
            await startCameraStream({ video: true });
        } else {
            // 안드로이드, PC는 후면 카메라 우선 시도
            await startCameraStream({ video: { facingMode: 'environment' } });
        }
    } catch (err) {
        console.error("카메라 접근 오류:", err);
        try {
            // 최종 백업 시도 (어떤 기기든 가능한 카메라)
            await startCameraStream({ video: true });
        } catch (finalErr) {
            console.error("모든 카메라 접근 오류:", finalErr);
            updateStatus('카메라에 접근할 수 없습니다. 권한을 확인해주세요.');
        }
    }
});

/*
// '카메라 시작' 버튼 클릭 시 실행
startCameraBtn.addEventListener('click', async () => {

    if (!model) {
        updateStatus('모델이 아직 로드되지 않았습니다. 잠시만 기다려주세요.');
        return;
    }

    capturePreviewContainer.classList.add('hidden');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' }
        });
        video.srcObject = stream;
        await video.play();        
        startCameraBtn.classList.add('hidden');
        updateStatus('카메라를 로딩 중입니다...');
    } catch (err) {
         console.error("카메라 접근 오류:", err);
         try {
             const stream = await navigator.mediaDevices.getUserMedia({ video: true });
             video.srcObject = stream;
             startCameraBtn.classList.add('hidden');
             updateStatus('카메라를 로딩 중입니다...');
         } catch (finalErr) {
             console.error("모든 카메라 접근 오류:", finalErr);
             updateStatus('카메라에 접근할 수 없습니다. 권한을 확인해주세요.');
         }
    }
});
*/

// 비디오 스트림의 메타데이터가 로드되면 실행
video.addEventListener('loadedmetadata', () => {

    // 캡처용 캔버스 크기를 실제 비디오 원본 크기와 동일하게 설정
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    resultContainer.classList.remove('hidden');
    captureBtn.classList.remove('hidden');

    setupCanvasAndObserver();
    predictLoop();
    updateStatus('실시간 객체 탐지 중...');
});

// 비디오 크기 변경될 때마다 캔버스 크기를 동기화
function setupCanvasAndObserver() {
    const resizeCanvas = () => {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
    };

    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(video);
    resizeCanvas();
}

// 실시간으로 객체를 탐지하고 결과를 그리는 메인 루프
async function predictLoop() {
    if (video.srcObject) {
        const predictions = await model.detect(video);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const legendData = {};
        
        drawPredictions(ctx, predictions, { 
            x: canvas.width / video.videoWidth, 
            y: canvas.height / video.videoHeight 
        }, legendData);

        if (isRecording) {
            captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
            captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
            drawPredictions(captureCtx, predictions);
        }
        
        updateLegend(legendData);
    }
    requestAnimationFrame(predictLoop);
}

// 객체 클래스 이름에 해당하는 고유 색상을 반환
// @param {string} className - 객체의 클래스 이름 (예: 'person')
function getColorForClass(className) {
    if (!classColorMap[className]) {
        classColorMap[className] = colors[colorIndex % colors.length];
        colorIndex++;
    }
    return classColorMap[className];
}

// 주어진 캔버스에 모든 탐지 결과 그리기
// @param {CanvasRenderingContext2D} context - 그림을 그릴 캔버스의 컨텍스트
// @param {Array} predictions - AI 모델이 반환한 탐지 결과 배열
// @param {Object} scale - 비디오 원본 크기와 화면 표시 크기 사이의 비율
// @param {Object} legendData - 범례 데이터를 채울 객체

function drawPredictions(context, predictions, scale = {x: 1, y: 1}, legendData = null) {
    predictions.forEach(prediction => {
        const color = getColorForClass(prediction.class);
        if (legendData && !legendData[prediction.class]) {
            legendData[prediction.class] = color;
        }
        
        const [x, y, width, height] = prediction.bbox;

        // 화면 크기에 맞게 좌표와 크기 조절
        const scaledX = x * scale.x;
        const scaledY = y * scale.y;
        const scaledWidth = width * scale.x;
        const scaledHeight = height * scale.y;
        
        // 사각형 그리기
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.beginPath();
        context.rect(scaledX, scaledY, scaledWidth, scaledHeight);
        context.stroke();
        
         // 객체 이름과 정확도 그리기
        const text = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
        context.fillStyle = color;
        context.font = '14px sans-serif';
        const textWidth = context.measureText(text).width;
        
        context.fillRect(scaledX, scaledY, textWidth + 8, 18);
        
        context.fillStyle = '#FFFFFF';
        context.fillText(text, scaledX + 4, scaledY + 14);
    });
}

// 탐지된 객체 목록으로 범례 업데이트
// @param {Object} legendData - 현재 프레임에서 탐지된 객체와 색상 정보
function updateLegend(legendData) {
    legend.innerHTML = '';
    for (const className in legendData) {
        const color = legendData[className];
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `<span class="legend-color" style="background-color: ${color};"></span> ${className}`;
        legend.appendChild(legendItem);
    }
}

// '캡처 시작/중지' 버튼 클릭 시 녹화 상태를 전환
captureBtn.addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

// 녹화를 시작하는 함수
function startRecording() {
    if (!model || !video.srcObject) return;
    
    capturePreviewContainer.classList.add('hidden');
    if (recordedVideoUrl) {
        URL.revokeObjectURL(recordedVideoUrl);  // 이전 녹화 영상 URL 해제
        recordedVideoUrl = null;
    }

    isRecording = true;
    recordedChunks = [];
    const stream = captureCanvas.captureStream(30);
    
    // 브라우저가 지원하는 비디오 포맷 확인(MP4 우선)
    const options = MediaRecorder.isTypeSupported('video/mp4; codecs=avc1')
        ? { mimeType: 'video/mp4; codecs=avc1' }
        : { mimeType: 'video/webm; codecs=vp9' };

    savedFileExtension = options.mimeType.includes('mp4') ? 'mp4' : 'webm';
    mediaRecorder = new MediaRecorder(stream, options);

    // 녹화 데이터가 생성될 때마다 실행되는 이벤트 핸들러
    mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);    // 데이터 조각을 배열에 추가
        }
    };


    // 녹화가 중지되면 실행되는 이벤트 핸들러
    mediaRecorder.onstop = () => {
        // 수집된 데이터 조각들을 합쳐 하나의 Blob 객체로 만들기
        const blob = new Blob(recordedChunks, { type: options.mimeType });
        recordedVideoUrl = URL.createObjectURL(blob);           // Blob을 위한 URL 생성
        recordedVideoPreview.src = recordedVideoUrl;            // 미리보기 비디오에 URL 설정
        capturePreviewContainer.classList.remove('hidden');     // 미리보기 컨테이너 보이기
        
        isRecording = false;
        captureBtn.textContent = '캡처 시작';
        updateStatus('캡처가 완료되었습니다. 아래에서 미리보고 저장하세요.');
    };

    mediaRecorder.start(100);   // 100ms 간격으로 ondataavailable 이벤트를 발생시키며 녹화 시작
    captureBtn.textContent = '캡처 중지';
    updateStatus('캡처가 시작되었습니다.');
}

// 녹화 중지
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

// '영상 저장' 버튼 클릭 시 녹화된 파일을 다운로드
saveVideoBtn.addEventListener('click', () => {
    if (!recordedVideoUrl) return;

    const a = document.createElement('a');                  // 다운로드를 위한 임시 <a> 태그 생성
    a.href = recordedVideoUrl;
    a.download = `captured_video.${savedFileExtension}`;    // 파일 이름 설정
    document.body.appendChild(a);
    a.click();                                              // 클릭 이벤트를 발생시켜 다운로드 실행
    document.body.removeChild(a);                           // 임시 태그 제거
});
