export function GET() {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Verification Debug</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #333;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    button {
      background: #0070f3;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      margin-right: 10px;
    }
    button.secondary {
      background: #f5f5f5;
      color: #333;
      border: 1px solid #ddd;
    }
    button.error {
      background: #e53e3e;
    }
    button:hover {
      opacity: 0.9;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status {
      margin-top: 20px;
      padding: 15px;
      border-radius: 5px;
    }
    .status.recording {
      background: #fed7d7;
      color: #e53e3e;
      animation: pulse 1.5s infinite;
    }
    .status.success {
      background: #c6f6d5;
      color: #38a169;
    }
    .status.error {
      background: #fed7d7;
      color: #e53e3e;
    }
    .meter {
      height: 20px;
      position: relative;
      background: #f5f5f5;
      border-radius: 10px;
      padding: 5px;
      box-shadow: inset 0 -1px 1px rgba(255,255,255,0.3);
      margin-top: 10px;
    }
    .meter > span {
      display: block;
      height: 100%;
      border-radius: 8px;
      background-color: #0070f3;
      position: relative;
      overflow: hidden;
      transition: width 0.2s;
    }
    .logs {
      background: #1e1e1e;
      color: #ddd;
      padding: 15px;
      border-radius: 5px;
      font-family: monospace;
      overflow-x: auto;
      white-space: pre-wrap;
      height: 150px;
      overflow-y: auto;
    }
    .divider {
      margin: 30px 0;
      border-top: 1px solid #ddd;
    }
    .result-container {
      margin-top: 20px;
    }
    .result-badge {
      display: inline-block;
      padding: 5px 10px;
      border-radius: 5px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .result-badge.success {
      background: #c6f6d5;
      color: #38a169;
    }
    .result-badge.failure {
      background: #fed7d7;
      color: #e53e3e;
    }
    .details {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 5px;
      border-left: 5px solid #ddd;
      font-family: monospace;
      white-space: pre-wrap;
    }
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.8; }
      100% { opacity: 1; }
    }
  </style>
</head>
<body>
  <h1>Voice Verification Debug UI</h1>
  
  <div class="card">
    <h2>Record Voice</h2>
    <p>Record your voice for verification. Try to speak for at least 5 seconds.</p>
    
    <div>
      <button id="startBtn">Start Recording</button>
      <button id="stopBtn" disabled>Stop Recording</button>
      <button id="clearBtn" class="secondary">Clear</button>
    </div>
    
    <div class="meter" style="display:none;">
      <span id="volumeMeter" style="width:0%"></span>
    </div>
    
    <div id="recordingStatus" class="status" style="display:none;"></div>
    
    <div id="audioContainer" style="margin-top:20px; display:none;">
      <p>Recorded Audio:</p>
      <audio id="audioPlayback" controls></audio>
      <div style="margin-top:10px;">
        <button id="verifyBtn">Verify Voice</button>
        <span id="audioInfo" style="margin-left:10px; font-size:14px;"></span>
      </div>
    </div>
    
    <div id="resultContainer" class="result-container" style="display:none;">
      <h3>Verification Result</h3>
      <div id="resultBadge" class="result-badge"></div>
      <div id="resultDetails" class="details"></div>
    </div>
  </div>
  
  <div class="divider"></div>
  
  <div class="card">
    <h2>Debug Logs</h2>
    <div id="logs" class="logs"></div>
  </div>

  <script>
    // Setup variables
    let mediaRecorder;
    let audioChunks = [];
    let audioBlob;
    let audioStream;
    let recordingTimer;
    let recordingDuration = 0;
    const minRecordingSeconds = 5;
    
    // DOM elements
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const clearBtn = document.getElementById('clearBtn');
    const recordingStatus = document.getElementById('recordingStatus');
    const audioContainer = document.getElementById('audioContainer');
    const audioPlayback = document.getElementById('audioPlayback');
    const verifyBtn = document.getElementById('verifyBtn');
    const audioInfo = document.getElementById('audioInfo');
    const resultContainer = document.getElementById('resultContainer');
    const resultBadge = document.getElementById('resultBadge');
    const resultDetails = document.getElementById('resultDetails');
    const logsElement = document.getElementById('logs');
    const volumeMeter = document.getElementById('volumeMeter');
    const meterContainer = document.querySelector('.meter');
    
    // Log function
    function log(message, type = 'info') {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      const entry = \`[\${timestamp}] [\${type.toUpperCase()}] \${message}\`;
      logsElement.innerHTML += entry + '\\n';
      logsElement.scrollTop = logsElement.scrollHeight;
      console.log(entry);
    }
    
    // Format time
    function formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return \`\${mins.toString().padStart(2, '0')}:\${secs.toString().padStart(2, '0')}\`;
    }
    
    // Audio visualization
    function setupAudioVisualization(stream) {
      if (!stream) return;
      
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        function updateMeter() {
          if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
          
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          const volume = Math.min(100, Math.max(0, average * 1.5)); // Scale for better visibility
          
          volumeMeter.style.width = \`\${volume}%\`;
          requestAnimationFrame(updateMeter);
        }
        
        meterContainer.style.display = 'block';
        updateMeter();
      } catch (err) {
        log('Audio visualization error: ' + err.message, 'error');
      }
    }
    
    // Start recording
    startBtn.addEventListener('click', async () => {
      try {
        // Reset variables
        audioChunks = [];
        recordingDuration = 0;
        resultContainer.style.display = 'none';
        
        // Update UI
        startBtn.disabled = true;
        stopBtn.disabled = false;
        recordingStatus.style.display = 'block';
        recordingStatus.className = 'status recording';
        
        log('Requesting microphone access...');
        
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 16000
          }
        });
        
        audioStream = stream;
        log('Microphone access granted');
        
        // Determine MIME type
        const mimeType = MediaRecorder.isTypeSupported('audio/wav') 
          ? 'audio/wav'
          : MediaRecorder.isTypeSupported('audio/webm') 
            ? 'audio/webm'
            : 'audio/webm';
        
        log(\`Using media recorder with MIME type: \${mimeType}\`);
        
        // Create media recorder
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: mimeType,
          audioBitsPerSecond: 16000
        });
        
        // Set up visualization
        setupAudioVisualization(stream);
        
        // Start recording and timer
        mediaRecorder.start(200);
        const startTime = Date.now();
        
        recordingTimer = setInterval(() => {
          recordingDuration = Math.floor((Date.now() - startTime) / 1000);
          recordingStatus.textContent = \`Recording... \${formatTime(recordingDuration)}\`;
          
          if (recordingDuration >= minRecordingSeconds) {
            recordingStatus.innerHTML = \`Recording... \${formatTime(recordingDuration)} <br/><small>You can stop recording now</small>\`;
          }
        }, 100);
        
        // Handle data available event
        mediaRecorder.addEventListener('dataavailable', event => {
          if (event.data.size > 0) {
            log(\`Received audio chunk: \${event.data.size} bytes\`);
            audioChunks.push(event.data);
          }
        });
        
        // Handle recording stopped
        mediaRecorder.addEventListener('stop', () => {
          log('Recording stopped after ' + recordingDuration + ' seconds');
          
          // Create audio blob and URL
          audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
          const audioUrl = URL.createObjectURL(audioBlob);
          
          // Set audio playback source
          audioPlayback.src = audioUrl;
          
          // Update UI
          audioContainer.style.display = 'block';
          recordingStatus.style.display = 'none';
          audioInfo.textContent = \`\${(audioBlob.size / 1024).toFixed(1)} KB, \${formatTime(recordingDuration)}\`;
          
          // Stop tracks
          audioStream.getTracks().forEach(track => track.stop());
          audioStream = null;
          
          // Clear timer
          clearInterval(recordingTimer);
          recordingTimer = null;
          
          // Reset buttons
          startBtn.disabled = false;
          stopBtn.disabled = true;
          meterContainer.style.display = 'none';
          
          log(\`Audio recording complete: \${audioBlob.size} bytes, type: \${audioBlob.type}\`);
        });
        
      } catch (error) {
        log('Error starting recording: ' + error.message, 'error');
        
        startBtn.disabled = false;
        stopBtn.disabled = true;
        
        if (error.name === 'NotAllowedError') {
          recordingStatus.textContent = 'Microphone access was denied. Please allow microphone access and try again.';
        } else {
          recordingStatus.textContent = \`Recording error: \${error.message || error.name}\`;
        }
        recordingStatus.className = 'status error';
      }
    });
    
    // Stop recording
    stopBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        log('Stopping recording manually');
      }
    });
    
    // Clear recording
    clearBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      
      audioChunks = [];
      audioBlob = null;
      
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
      }
      
      if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
      }
      
      audioContainer.style.display = 'none';
      recordingStatus.style.display = 'none';
      resultContainer.style.display = 'none';
      meterContainer.style.display = 'none';
      
      startBtn.disabled = false;
      stopBtn.disabled = true;
      
      log('Recording cleared');
    });
    
    // Verify voice
    verifyBtn.addEventListener('click', async () => {
      if (!audioBlob) {
        log('No audio recording to verify', 'error');
        return;
      }
      
      try {
        log('Starting voice verification...');
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
        
        // Convert blob to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        
        reader.onload = async () => {
          const base64Audio = reader.result;
          log(\`Audio converted to base64, length: \${base64Audio.length} chars\`);
          
          // Make verification request
          log('Sending verification request to API...');
          
          try {
            const response = await fetch('/api/voice-verification', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                audioData: base64Audio,
              }),
            });
            
            log(\`API response status: \${response.status}\`);
            
            const result = await response.json();
            log('Verification result received', 'success');
            log(JSON.stringify(result, null, 2));
            
            // Display result
            resultContainer.style.display = 'block';
            
            if (result.verified) {
              resultBadge.textContent = 'VERIFIED';
              resultBadge.className = 'result-badge success';
              resultDetails.textContent = \`Score: \${result.score.toFixed(3)}\\nThreshold: \${result.threshold.toFixed(3)}\`;
            } else {
              resultBadge.textContent = 'VERIFICATION FAILED';
              resultBadge.className = 'result-badge failure';
              resultDetails.textContent = \`Error: \${result.error || 'Voice verification failed'}\\n\${JSON.stringify(result.details || {}, null, 2)}\`;
            }
            
          } catch (error) {
            log(\`API request error: \${error.message}\`, 'error');
            
            resultContainer.style.display = 'block';
            resultBadge.textContent = 'ERROR';
            resultBadge.className = 'result-badge failure';
            resultDetails.textContent = \`Failed to communicate with verification API:\\n\${error.message}\`;
          }
          
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify Voice';
        };
        
      } catch (error) {
        log(\`Verification error: \${error.message}\`, 'error');
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify Voice';
      }
    });
    
    // Initial log
    log('Voice verification debug UI loaded');
    log(\`Browser: \${navigator.userAgent}\`);
    
    // Check for microphone support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('MediaDevices.getUserMedia not supported in this browser', 'error');
    } else {
      log('MediaDevices.getUserMedia is supported');
    }
    
    // Check for MediaRecorder support
    if (!window.MediaRecorder) {
      log('MediaRecorder not supported in this browser', 'error');
    } else {
      log('MediaRecorder is supported');
      
      // Log supported MIME types
      const mimeTypes = ['audio/wav', 'audio/webm', 'audio/mp3', 'audio/ogg', 'audio/mpeg'];
      mimeTypes.forEach(type => {
        log(\`MIME type \${type}: \${MediaRecorder.isTypeSupported(type) ? 'supported' : 'not supported'}\`);
      });
    }
  </script>
</body>
</html>
`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}
