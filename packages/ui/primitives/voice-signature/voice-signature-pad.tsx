'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

import { Trans } from '@lingui/macro';
import { Mic, Pause, Play, Trash2, UploadCloud } from 'lucide-react';

import { unsafe_useEffectOnce } from '@documenso/lib/client-only/hooks/use-effect-once';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';

export type VoiceSignatureDataFormat = {
  audioBlob: Blob;
  audioUrl: string;
  videoBlob?: Blob; // Only used for enrollment
  videoUrl?: string; // Only used for enrollment
  transcript?: string;
  duration: number;
  waveformData: number[];
};

export type VoiceSignaturePadProps = Omit<HTMLAttributes<HTMLCanvasElement>, 'onChange'> & {
  onChange?: (_voiceData: VoiceSignatureDataFormat | null) => void;
  onValidityChange?: (isValid: boolean) => void;
  containerClassName?: string;
  disabled?: boolean;
  defaultValue?: VoiceSignatureDataFormat | string;
  isEnrollment?: boolean; // Whether this is for enrollment (video) or regular signing (audio)
  promptText?: string;
  minDuration?: number; // Minimum recording duration in seconds
};

export const VoiceSignaturePad = ({
  className,
  containerClassName,
  defaultValue,
  onChange,
  onValidityChange,
  disabled = false,
  isEnrollment = false,
  promptText = '',
  minDuration = 3, // Default to 3 seconds minimum
  ...props
}: VoiceSignaturePadProps) => {
  const $canvas = useRef<HTMLCanvasElement>(null);
  const $fileInput = useRef<HTMLInputElement>(null);
  const $audioElement = useRef<HTMLAudioElement>(null);
  const $videoElement = useRef<HTMLVideoElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordStartTime, setRecordStartTime] = useState<number | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [videoChunks, setVideoChunks] = useState<Blob[]>([]);
  const [voiceData, setVoiceData] = useState<VoiceSignatureDataFormat | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isValid = useMemo(() => {
    if (!voiceData) return false;
    return voiceData.duration >= minDuration;
  }, [voiceData, minDuration]);

  // Handle changes to validity
  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  const startRecording = async () => {
    try {
      setErrorMessage(null);
      const constraints = isEnrollment ? { audio: true, video: true } : { audio: true };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      const recorder = new MediaRecorder(mediaStream);
      setMediaRecorder(recorder);

      // Safely check for webkit prefix
      const AudioContextClass =
        window.AudioContext ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(mediaStream);
      microphone.connect(analyser);
      analyser.fftSize = 256;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const chunks: Blob[] = [];
      const videoChunksArray: Blob[] = [];
      setAudioChunks(chunks);
      setVideoChunks(videoChunksArray);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          if (isEnrollment) {
            videoChunksArray.push(event.data);
            setVideoChunks([...videoChunksArray]);
          } else {
            chunks.push(event.data);
            setAudioChunks([...chunks]);
          }
        }
      };

      setRecordStartTime(Date.now());
      setIsRecording(true);
      recorder.start(100);

      // Start drawing waveform
      const drawInterval = setInterval(() => {
        if (recordStartTime) {
          setRecordingDuration(Math.floor((Date.now() - recordStartTime) / 1000));
        }

        analyser.getByteFrequencyData(dataArray);

        // Calculate audio level for visualization
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }

        const average = sum / bufferLength;
        const normalized = average / 256; // Normalize between 0 and 1

        setWaveformData((data) => [...data, normalized]);
      }, 100);

      setIntervalId(drawInterval);
    } catch (error) {
      console.error('Error starting recording:', error);
      setErrorMessage('Could not access microphone. Please check your browser permissions.');
    }
  };

  const stopRecording = () => {
    if (!mediaRecorder || !stream) return;

    mediaRecorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    setStream(null);
    setIsRecording(false);
    setRecordStartTime(null);

    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }

    // Process the recorded data
    setTimeout(() => {
      if (isEnrollment && videoChunks.length > 0) {
        const videoBlob = new Blob(videoChunks, { type: 'video/webm' });
        const videoUrl = URL.createObjectURL(videoBlob);

        // Extract audio from video
        // For development purposes, we're just creating the data structure
        // In production, we would use ffmpeg.js or a server-side solution
        const voiceSignatureData: VoiceSignatureDataFormat = {
          audioBlob: videoBlob, // In dev mode, use the video as audio
          audioUrl: videoUrl, // In dev mode, use the video URL
          videoBlob,
          videoUrl,
          duration: recordingDuration,
          waveformData: waveformData.slice(-50), // Keep last 50 samples
        };

        setVoiceData(voiceSignatureData);
        onChange?.(voiceSignatureData);
      } else if (audioChunks.length > 0) {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);

        const voiceSignatureData: VoiceSignatureDataFormat = {
          audioBlob,
          audioUrl,
          duration: recordingDuration,
          waveformData: waveformData.slice(-50), // Keep last 50 samples
        };

        setVoiceData(voiceSignatureData);
        onChange?.(voiceSignatureData);
      }
    }, 300);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');

    if ((!isEnrollment && !isAudio) || (isEnrollment && !isVideo)) {
      setErrorMessage(
        isEnrollment ? 'Please upload a video file.' : 'Please upload an audio file.',
      );
      return;
    }

    const url = URL.createObjectURL(file);

    if (isEnrollment && isVideo) {
      // Load the video to get its duration
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Math.round(video.duration);

        // Generate mock waveform data for uploaded video
        const mockWaveform = Array(50)
          .fill(0)
          .map(() => Math.random() * 0.8 + 0.2);

        const voiceSignatureData: VoiceSignatureDataFormat = {
          audioBlob: file, // In dev mode, use video as audio
          audioUrl: url,
          videoBlob: file,
          videoUrl: url,
          duration,
          waveformData: mockWaveform,
        };

        setVoiceData(voiceSignatureData);
        onChange?.(voiceSignatureData);
        URL.revokeObjectURL(url); // Clean up
      };

      video.src = url;
    } else if (isAudio) {
      // Load the audio to get its duration
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const duration = Math.round(audio.duration);

        // Generate mock waveform data for uploaded audio
        const mockWaveform = Array(50)
          .fill(0)
          .map(() => Math.random() * 0.8 + 0.2);

        const voiceSignatureData: VoiceSignatureDataFormat = {
          audioBlob: file,
          audioUrl: url,
          duration,
          waveformData: mockWaveform,
        };

        setVoiceData(voiceSignatureData);
        onChange?.(voiceSignatureData);
        URL.revokeObjectURL(url); // Clean up
      };

      audio.src = url;
    }
  };

  const onClearClick = () => {
    setVoiceData(null);
    setWaveformData([]);
    setRecordingDuration(0);

    if ($fileInput.current) {
      $fileInput.current.value = '';
    }

    if ($audioElement.current) {
      $audioElement.current.pause();
      $audioElement.current.src = '';
    }

    if ($videoElement.current) {
      $videoElement.current.pause();
      $videoElement.current.src = '';
    }

    setIsPlaying(false);
    onChange?.(null);
  };

  const togglePlayback = () => {
    if (isEnrollment && $videoElement.current) {
      if (isPlaying) {
        $videoElement.current.pause();
      } else {
        void $videoElement.current.play();
      }
      setIsPlaying(!isPlaying);
    } else if ($audioElement.current) {
      if (isPlaying) {
        $audioElement.current.pause();
      } else {
        void $audioElement.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const drawWaveform = () => {
    if (!$canvas.current || !voiceData?.waveformData.length) return;

    const canvas = $canvas.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ensure canvas dimensions are up to date
    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set appropriate style
    ctx.strokeStyle = isRecording ? '#ef4444' : '#2563eb';
    ctx.lineWidth = 2;

    // Draw waveform
    const waveform = voiceData.waveformData;
    const step = canvas.width / waveform.length;
    const middleY = canvas.height / 2;

    ctx.beginPath();
    for (let i = 0; i < waveform.length; i++) {
      const amplitude = waveform[i] * middleY;
      const x = i * step;

      // Draw bar rather than a continuous line
      ctx.moveTo(x, middleY - amplitude);
      ctx.lineTo(x, middleY + amplitude);
    }
    ctx.stroke();
  };

  // Draw waveform when data changes
  useEffect(() => {
    drawWaveform();
  }, [voiceData?.waveformData, isRecording]);

  // Handle window resize for canvas
  useEffect(() => {
    const handleResize = () => {
      drawWaveform();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [voiceData]);

  // Handle media playback ended event
  useEffect(() => {
    const handleEnded = () => {
      setIsPlaying(false);
    };

    if ($audioElement.current) {
      $audioElement.current.addEventListener('ended', handleEnded);
    }

    if ($videoElement.current) {
      $videoElement.current.addEventListener('ended', handleEnded);
    }

    return () => {
      if ($audioElement.current) {
        $audioElement.current.removeEventListener('ended', handleEnded);
      }

      if ($videoElement.current) {
        $videoElement.current.removeEventListener('ended', handleEnded);
      }
    };
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [stream, intervalId]);

  // Initialize with default value if provided
  unsafe_useEffectOnce(() => {
    if (typeof defaultValue === 'object' && defaultValue !== null) {
      setVoiceData(defaultValue);
      setWaveformData(defaultValue.waveformData || []);
      setRecordingDuration(defaultValue.duration || 0);
    }
  });

  return (
    <div
      className={cn('relative block select-none', containerClassName, {
        'pointer-events-none opacity-50': disabled,
      })}
    >
      {/* Main canvas for waveform visualization */}
      <canvas ref={$canvas} className={cn('h-full w-full rounded-md', className)} {...props} />

      {/* Prompt text */}
      {promptText && !voiceData && !isRecording && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-muted-foreground text-center text-sm">{promptText}</p>
        </div>
      )}

      {/* Audio player (hidden) */}
      <audio ref={$audioElement} src={voiceData?.audioUrl} className="hidden" />

      {/* Video player for enrollment (hidden) */}
      {isEnrollment && <video ref={$videoElement} src={voiceData?.videoUrl} className="hidden" />}

      {/* Error message */}
      {errorMessage && <div className="text-destructive mt-2 text-sm">{errorMessage}</div>}

      {/* Recording duration */}
      {(isRecording || voiceData) && (
        <div className="text-muted-foreground absolute left-3 top-3 text-xs">
          {isRecording ? `Recording: ${recordingDuration}s` : `Duration: ${voiceData?.duration}s`}
        </div>
      )}

      {/* Control buttons */}
      <div className="absolute bottom-3 left-3 right-3">
        <div className="flex items-center justify-between">
          {/* Record/Stop button */}
          <Button
            type="button"
            variant={isRecording ? 'destructive' : 'secondary'}
            size="sm"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isPlaying || (!isRecording && !!voiceData)}
          >
            {isRecording ? (
              <>
                <Pause className="mr-1 h-4 w-4" />
                <Trans>Stop</Trans>
              </>
            ) : (
              <>
                <Mic className="mr-1 h-4 w-4" />
                <Trans>Record</Trans>
              </>
            )}
          </Button>

          {/* Playback button (only shown when recording exists) */}
          {voiceData && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={togglePlayback}
              disabled={isRecording}
            >
              {isPlaying ? (
                <>
                  <Pause className="mr-1 h-4 w-4" />
                  <Trans>Pause</Trans>
                </>
              ) : (
                <>
                  <Play className="mr-1 h-4 w-4" />
                  <Trans>Play</Trans>
                </>
              )}
            </Button>
          )}

          {/* Upload button */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => $fileInput.current?.click()}
            disabled={isRecording || isPlaying}
          >
            <UploadCloud className="mr-1 h-4 w-4" />
            <Trans>Upload</Trans>
            <Input
              ref={$fileInput}
              type="file"
              accept={isEnrollment ? 'video/*' : 'audio/*'}
              className="hidden"
              onChange={handleFileUpload}
              disabled={disabled || isRecording || isPlaying}
            />
          </Button>

          {/* Clear button (only shown when recording exists) */}
          {voiceData && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClearClick}
              disabled={isRecording || isPlaying}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              <Trans>Clear</Trans>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
