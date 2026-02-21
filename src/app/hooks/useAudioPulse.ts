import { useState, useRef, useCallback } from 'react';

interface AudioPulseState {
  isRecording: boolean;
  audioBlob: Blob | null;
  peakEnergy: number; 
  liveEnergy: number; 
}

export const useAudioPulse = () => {
  const [state, setState] = useState<AudioPulseState>({
    isRecording: false,
    audioBlob: null,
    peakEnergy: 0,
    liveEnergy: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const animationFrameRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Browser blocking microphone access. Use http://localhost:3000.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      mediaRecorderRef.current = new MediaRecorder(stream);
      const audioChunks: BlobPart[] = [];

      mediaRecorderRef.current.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        setState(prev => ({ ...prev, isRecording: false, audioBlob }));
        stream.getTracks().forEach(track => track.stop());
        cancelAnimationFrame(animationFrameRef.current);
      };

      let currentPeak = 0;

      const analyzeAudio = () => {
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / bufferLength;
        const normalizedEnergy = average / 255; 

        if (normalizedEnergy > currentPeak) currentPeak = normalizedEnergy;

        setState(prev => ({ 
          ...prev, 
          liveEnergy: normalizedEnergy,
          peakEnergy: currentPeak 
        }));

        animationFrameRef.current = requestAnimationFrame(analyzeAudio);
      };

      mediaRecorderRef.current.start();
      setState(prev => ({ ...prev, isRecording: true, audioBlob: null, peakEnergy: 0 }));
      analyzeAudio();

    } catch (error) {
      console.error('Microphone access denied.', error);
    }
  }, []);

  // NEW: Manual stop function
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { ...state, startRecording, stopRecording };
};