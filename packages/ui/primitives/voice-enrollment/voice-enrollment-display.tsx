'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Pause, Play, RefreshCcw, Volume2 } from 'lucide-react';

import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import { Progress } from '@documenso/ui/primitives/progress';

export interface VoiceEnrollmentDisplayProps {
  className?: string;
  videoUrl?: string | null;
  audioUrl?: string | null;
  duration?: number | null;
}

export const VoiceEnrollmentDisplay = ({
  className,
  videoUrl,
  audioUrl,
  duration,
}: VoiceEnrollmentDisplayProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProcessed, setIsProcessed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [hasAttemptedPlay, setHasAttemptedPlay] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [videoDetails, setVideoDetails] = useState<string | null>(null);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [isLoadingUrls, setIsLoadingUrls] = useState(false);

  // For presigned URLs
  const [presignedVideoUrl, setPresignedVideoUrl] = useState<string | null>(null);
  const [presignedAudioUrl, setPresignedAudioUrl] = useState<string | null>(null);

  // Format time in MM:SS format
  const formatTime = (timeInSeconds: number) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Update time display during playback
  const updateTimeDisplay = () => {
    const mediaElement = videoRef.current || audioRef.current;
    if (mediaElement) {
      setCurrentTime(mediaElement.currentTime);

      // Also update total duration if we now have it
      if (mediaElement.duration && !isNaN(mediaElement.duration)) {
        setTotalDuration(mediaElement.duration);
      }
    }
  };

  // Start a manual timer as backup when automatic events aren't reliable
  const startTimeTracker = useCallback(() => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Create a new interval that updates every 100ms
    intervalRef.current = setInterval(() => {
      const mediaElement = videoRef.current || audioRef.current;
      if (mediaElement && !mediaElement.paused) {
        setCurrentTime(mediaElement.currentTime);
        console.log('Manual tracker: currentTime =', mediaElement.currentTime);
      } else if (intervalRef.current && !isPlaying) {
        // Clean up if we're not playing anymore
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 100);
  }, [isPlaying]);

  // Stop the manual time tracker
  const stopTimeTracker = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Extract S3 key from URL
  const getS3KeyFromUrl = useCallback((url: string | null) => {
    if (!url) return null;

    try {
      // For URLs like https://s3.us-west-1.amazonaws.com/mikael-documenso/path/to/file.webm
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');

      // Remove bucket name from path if included in URL
      if (pathParts[1] === 'mikael-documenso') {
        return pathParts.slice(2).join('/');
      }

      // For URLs where bucket is in hostname or other formats
      return pathParts.slice(1).join('/');
    } catch (e) {
      console.error('Error parsing URL:', e);
      return null;
    }
  }, []);

  // Fetch presigned URLs
  const fetchPresignedUrls = useCallback(async () => {
    if (!videoUrl && !audioUrl) return;

    setIsLoadingUrls(true);
    setPlaybackError(null);

    try {
      // Handle video URL
      if (videoUrl) {
        const videoKey = getS3KeyFromUrl(videoUrl);

        if (videoKey) {
          console.log('Fetching presigned URL for video key:', videoKey);

          const response = await fetch('/api/media-presigned', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: videoKey }),
          });

          if (response.ok) {
            const { url } = await response.json();
            console.log('Received presigned video URL');
            setPresignedVideoUrl(url);
          } else {
            console.error('Failed to get presigned URL for video', await response.text());
            setPlaybackError('Could not load secure video URL');
          }
        }
      }

      // Handle audio URL
      if (audioUrl) {
        const audioKey = getS3KeyFromUrl(audioUrl);

        if (audioKey) {
          console.log('Fetching presigned URL for audio key:', audioKey);

          const response = await fetch('/api/media-presigned', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: audioKey }),
          });

          if (response.ok) {
            const { url } = await response.json();
            console.log('Received presigned audio URL');
            setPresignedAudioUrl(url);
          } else {
            console.error('Failed to get presigned URL for audio', await response.text());
            setPlaybackError('Could not load secure audio URL');
          }
        }
      }
    } catch (error) {
      console.error('Error fetching presigned URLs:', error);
      setPlaybackError('Error getting secure media access');
    } finally {
      setIsLoadingUrls(false);
    }
  }, [videoUrl, audioUrl, getS3KeyFromUrl]);

  // Check if the browser supports WebM format
  const checkWebMSupport = useCallback(() => {
    const video = document.createElement('video');
    return video.canPlayType('video/webm') !== '';
  }, []);

  // Log details about the video URL and format
  const logVideoDetails = useCallback(() => {
    if (!videoUrl) return 'No video URL provided';

    const isWebM =
      videoUrl.toLowerCase().includes('.webm') || videoUrl.toLowerCase().includes('webm');
    const webMSupported = checkWebMSupport();

    const details = {
      url: videoUrl.substring(0, 50) + (videoUrl.length > 50 ? '...' : ''),
      format: isWebM ? 'WebM' : 'Unknown',
      webMSupported,
      crossOrigin:
        videoUrl.startsWith('http') && !videoUrl.includes(window.location.hostname)
          ? 'Yes (potential CORS issue)'
          : 'No',
    };

    console.log('Video details:', details);
    return details;
  }, [videoUrl, checkWebMSupport]);

  useEffect(() => {
    // Reset the playing state when video URL changes
    setIsPlaying(false);
    setCurrentTime(0);
    setHasAttemptedPlay(false);
    setPlaybackError(null);
    setIsVideoLoaded(false);
    setPresignedVideoUrl(null);
    setPresignedAudioUrl(null);

    // Consider it processed if either audio or video is available
    setIsProcessed(Boolean(videoUrl) || Boolean(audioUrl));

    // Initial duration setup
    if (duration) {
      setTotalDuration(duration);
    }

    // Log video details when URL changes
    if (videoUrl) {
      const details = logVideoDetails();
      setVideoDetails(JSON.stringify(details, null, 2));
    }

    // Fetch presigned URLs when the component loads or URLs change
    void fetchPresignedUrls();

    // Return cleanup function to stop timer when component unmounts
    return () => {
      stopTimeTracker();
    };
  }, [videoUrl, audioUrl, duration, fetchPresignedUrls, logVideoDetails, stopTimeTracker]);

  // Separate effect for attaching event listeners after refs are established
  useEffect(() => {
    const videoElement = videoRef.current;
    const audioElement = audioRef.current;

    // Event handler for time updates
    const handleTimeUpdate = () => {
      console.log('Time update event fired');
      updateTimeDisplay();
    };

    // Event handler for when metadata is loaded
    const handleLoadedMetadata = () => {
      const element = videoElement || audioElement;
      if (element && element.duration && !isNaN(element.duration)) {
        console.log('Metadata loaded, duration:', element.duration);
        setTotalDuration(element.duration);
      }
    };

    // Event handler for when video data is loaded
    const handleLoadedData = () => {
      console.log('Media data loaded');
      setIsVideoLoaded(true);
    };

    // Error event handler
    const handleError = (e: Event) => {
      const target = e.currentTarget as HTMLMediaElement;
      console.error('Media error:', target.error);
      const errorCode = target.error?.code || 0;
      let errorMessage = 'Unknown error';

      switch (errorCode) {
        case 1:
          errorMessage = 'Video fetching aborted';
          break;
        case 2:
          errorMessage = 'Network error while loading video';
          break;
        case 3:
          errorMessage = 'Video decoding failed - format may be unsupported';
          break;
        case 4:
          errorMessage = 'Video is not playable (possibly due to DRM or format)';
          break;
      }

      setPlaybackError(errorMessage);
    };

    // Play event handler
    const handlePlay = () => {
      console.log('Play event fired');
      setIsPlaying(true);
      startTimeTracker(); // Start manual tracker on play
    };

    // Pause event handler
    const handlePause = () => {
      console.log('Pause event fired');
      setIsPlaying(false);
      stopTimeTracker(); // Stop manual tracker on pause
    };

    // Add event listeners to video element if it exists
    if (videoElement) {
      videoElement.addEventListener('timeupdate', handleTimeUpdate);
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.addEventListener('loadeddata', handleLoadedData);
      videoElement.addEventListener('error', handleError);
      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
    }

    // Add event listeners to audio element if it exists
    if (audioElement) {
      audioElement.addEventListener('timeupdate', handleTimeUpdate);
      audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      audioElement.addEventListener('loadeddata', handleLoadedData);
      audioElement.addEventListener('error', handleError);
      audioElement.addEventListener('play', handlePlay);
      audioElement.addEventListener('pause', handlePause);
    }

    // Clean up event listeners
    return () => {
      if (videoElement) {
        videoElement.removeEventListener('timeupdate', handleTimeUpdate);
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoElement.removeEventListener('loadeddata', handleLoadedData);
        videoElement.removeEventListener('error', handleError);
        videoElement.removeEventListener('play', handlePlay);
        videoElement.removeEventListener('pause', handlePause);
      }
      if (audioElement) {
        audioElement.removeEventListener('timeupdate', handleTimeUpdate);
        audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audioElement.removeEventListener('loadeddata', handleLoadedData);
        audioElement.removeEventListener('error', handleError);
        audioElement.removeEventListener('play', handlePlay);
        audioElement.removeEventListener('pause', handlePause);
      }
    };
  }, [videoRef.current, audioRef.current, startTimeTracker, stopTimeTracker]); // Only run when refs change

  // Debug function to check media element status
  const logMediaStatus = (mediaElement: HTMLMediaElement | null) => {
    if (!mediaElement) return 'No media element';

    return {
      readyState: mediaElement.readyState,
      paused: mediaElement.paused,
      currentTime: mediaElement.currentTime,
      duration: mediaElement.duration,
      muted: mediaElement.muted,
      volume: mediaElement.volume,
      networkState: mediaElement.networkState,
      error: mediaElement.error ? `Error code: ${mediaElement.error.code}` : 'No error',
      videoWidth: 'videoWidth' in mediaElement ? mediaElement.videoWidth : 'N/A',
      videoHeight: 'videoHeight' in mediaElement ? mediaElement.videoHeight : 'N/A',
      src: mediaElement.src,
    };
  };

  const handlePlay = () => {
    if (!videoRef.current && !audioRef.current) return;

    setHasAttemptedPlay(true);
    setPlaybackError(null);
    console.log('Video status:', logMediaStatus(videoRef.current));
    console.log('Audio status:', logMediaStatus(audioRef.current));

    if (isPlaying) {
      if (videoRef.current) {
        videoRef.current.pause();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      stopTimeTracker();
    } else {
      // Try to play the video
      if (videoRef.current) {
        // Ensure audio is not muted and volume is up
        videoRef.current.muted = false;
        videoRef.current.volume = 1.0;

        videoRef.current
          .play()
          .then(() => {
            setIsPlaying(true);
            startTimeTracker();
          })
          .catch((err) => {
            console.error('Error playing video:', err);
            setPlaybackError('Video playback failed. Trying audio...');

            // If video fails, try to play the audio (as fallback)
            if (audioRef.current) {
              playAudio();
            }
          });
      }
      // If no video, try audio
      else if (audioRef.current) {
        playAudio();
      }
    }
  };

  const playAudio = () => {
    if (!audioRef.current) return;

    // Ensure audio is not muted and volume is up
    audioRef.current.muted = false;
    audioRef.current.volume = 1.0;

    audioRef.current
      .play()
      .then(() => {
        setIsPlaying(true);
        startTimeTracker();
      })
      .catch((err) => {
        console.error('Error playing audio:', err);
        setPlaybackError('Could not play audio. Please try again or update your browser.');
        setIsPlaying(false);
      });
  };

  const handleReset = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }

    setCurrentTime(0);
    setIsPlaying(false);
    stopTimeTracker();
  };

  // Handle the end of playback
  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    stopTimeTracker();
  };

  // Handle retry for fetching presigned URLs
  const handleRetry = () => {
    void fetchPresignedUrls();
  };

  if (!isProcessed) {
    return (
      <div className={cn('bg-muted rounded-lg border p-4 text-center', className)}>
        <Volume2 className="text-muted-foreground mx-auto mb-2 h-10 w-10" />
        <p className="text-muted-foreground text-sm">No voice enrollment available</p>
      </div>
    );
  }

  if (isLoadingUrls) {
    return (
      <div className={cn('rounded-lg border p-4', className)}>
        <div className="flex flex-col gap-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
            <div className="bg-muted flex h-full items-center justify-center">
              <p className="text-muted-foreground">Loading secure media...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border p-4', className)}>
      <div className="flex flex-col gap-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
          {presignedVideoUrl ? (
            <>
              <video
                ref={videoRef}
                src={presignedVideoUrl}
                className="h-full w-full object-contain"
                onEnded={handleEnded}
                controls={false}
                playsInline
                muted={false}
                preload="auto"
              />
              {process.env.NODE_ENV !== 'production' && (
                <div className="absolute left-0 top-0 z-10 bg-black/70 p-1 text-xs text-white">
                  {isVideoLoaded ? (
                    <span>
                      {videoRef.current &&
                        `${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`}
                    </span>
                  ) : (
                    <span>Loading...</span>
                  )}
                </div>
              )}
            </>
          ) : presignedAudioUrl ? (
            <div className="bg-muted flex h-full items-center justify-center">
              <Volume2
                className={cn(
                  'h-12 w-12',
                  isPlaying ? 'text-primary animate-pulse' : 'text-muted-foreground',
                )}
              />
              <audio
                ref={audioRef}
                src={presignedAudioUrl}
                onEnded={handleEnded}
                controls={false}
                muted={false}
                preload="auto"
              />
            </div>
          ) : (
            <div className="bg-muted flex h-full items-center justify-center">
              <p className="text-muted-foreground">Error loading media</p>
            </div>
          )}

          {playbackError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
              <p className="mb-2 rounded bg-black/70 p-2 text-sm text-white">{playbackError}</p>
              <Button variant="secondary" size="sm" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          )}

          {hasAttemptedPlay && !isPlaying && !playbackError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/10">
              <p className="rounded bg-black/50 p-2 text-sm text-white/75">
                {presignedVideoUrl ? 'Click play to view video' : 'Click play to listen'}
              </p>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full">
          <Progress
            value={totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}
            className="h-1"
          />
          <div className="text-muted-foreground mt-1 flex justify-between text-xs">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(totalDuration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-sm">
            {isPlaying ? 'Playing...' : hasAttemptedPlay ? 'Paused' : 'Ready to play'}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!isProcessed || (!presignedVideoUrl && !presignedAudioUrl)}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>

            <Button
              variant={isPlaying ? 'outline' : 'default'}
              size="sm"
              onClick={handlePlay}
              disabled={!isProcessed || (!presignedVideoUrl && !presignedAudioUrl)}
            >
              {isPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {isPlaying ? 'Pause' : 'Play'}
            </Button>
          </div>
        </div>

        {process.env.NODE_ENV !== 'production' && videoDetails && (
          <div className="bg-muted mt-4 rounded-md p-2">
            <details>
              <summary className="cursor-pointer text-xs">Video Debug Info</summary>
              <pre className="mt-2 max-h-24 overflow-auto text-xs">{videoDetails}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
};
