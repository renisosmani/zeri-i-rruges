'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Map, { Marker, MapRef } from 'react-map-gl/maplibre';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Play, Square, Volume2 } from 'lucide-react';
import { useAudioPulse } from '@/app/hooks/useAudioPulse';
import { supabase } from '@/utils/supabase'; // Cloud Database Connection
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const ALBANIA_BOUNDS: [number, number, number, number] = [18.5, 39.5, 21.5, 43.0];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Exactly 24 Hours

type Pulse = { id: string; lat: number; lng: number; energy_value: number; audio_url: string; created_at: string };

function MapEngine() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activePulse, setActivePulse] = useState<Pulse | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const mapRef = useRef<MapRef>(null);
  
  const searchParams = useSearchParams();
  const { isRecording, liveEnergy, peakEnergy, audioBlob, startRecording, stopRecording } = useAudioPulse();
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const pannerRef = useRef<StereoPannerNode | null>(null);
  const currentAudioElement = useRef<HTMLAudioElement | null>(null);

  // 1. FETCH LIVE CLOUD DATA (Only the last 24 hours)
  useEffect(() => {
    const fetchPulses = async () => {
      const yesterday = new Date(Date.now() - MAX_AGE_MS).toISOString();
      
      const { data, error } = await supabase
        .from('pulses')
        .select('*')
        .gte('created_at', yesterday); // The magic filter!
        
      if (data) setPulses(data);
      if (error) console.error("Error fetching pulses:", error);
    };

    fetchPulses();
    
    // Optional: Refresh data every minute to naturally fade out old pulses
    const interval = setInterval(fetchPulses, 60000);
    return () => clearInterval(interval);
  }, []);

  // 2. FLY TO SHARED PULSE
  useEffect(() => {
    const sharedId = searchParams.get('pulse');
    if (sharedId && pulses.length > 0) {
      const target = pulses.find(p => p.id === sharedId);
      if (target && mapRef.current) {
        mapRef.current.flyTo({ center: [target.lng, target.lat], zoom: 12, duration: 2000 });
      }
    }
  }, [searchParams, pulses]);

  // 3. UPLOAD TO SUPABASE
  useEffect(() => {
    const uploadPulse = async () => {
      if (!isRecording && audioBlob && peakEnergy > 0) {
        setIsUploading(true);
        
        try {
          // A. Get User Location
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject);
          });

          // B. Upload Audio File to Cloud Storage
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.webm`;
          const { error: uploadError } = await supabase.storage
            .from('audio_pulses')
            .upload(fileName, audioBlob, { contentType: 'audio/webm' });

          if (uploadError) throw uploadError;

          // C. Get the public URL of the uploaded audio
          const { data: publicUrlData } = supabase.storage
            .from('audio_pulses')
            .getPublicUrl(fileName);

          // D. Save everything to the Database
          const newPulse = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            energy_value: peakEnergy,
            audio_url: publicUrlData.publicUrl,
          };

          const { data: insertData, error: insertError } = await supabase
            .from('pulses')
            .insert([newPulse])
            .select();

          if (insertError) throw insertError;
          if (insertData) setPulses(prev => [...prev, insertData[0]]);

        } catch (error) {
          console.error("Failed to drop pulse:", error);
          alert("Error saving pulse to the cloud.");
        } finally {
          setIsUploading(false);
        }
      }
    };

    uploadPulse();
  }, [isRecording, audioBlob, peakEnergy]);

  const handlePlayPulse = (pulse: Pulse) => {
    setActivePulse(pulse);
    if (currentAudioElement.current) currentAudioElement.current.pause();

    const audio = new Audio(pulse.audio_url);
    currentAudioElement.current = audio;

    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    if (!audioSourceRef.current || audioSourceRef.current.mediaElement !== audio) {
      const source = audioCtxRef.current.createMediaElementSource(audio);
      const panner = audioCtxRef.current.createStereoPanner();
      source.connect(panner);
      panner.connect(audioCtxRef.current.destination);
      
      audioSourceRef.current = source;
      pannerRef.current = panner;
    }

    if (mapRef.current && pannerRef.current) {
      const mapCenterLng = mapRef.current.getCenter().lng;
      pannerRef.current.pan.value = Math.max(-1, Math.min(1, (pulse.lng - mapCenterLng) * 2)); 
    }

    audio.play();
    audio.onended = () => setActivePulse(null);
  };

  const handleShare = (id: string) => {
    const url = `${window.location.origin}?pulse=${id}`;
    navigator.clipboard.writeText(url);
    alert("Pulse Link Copied! Share it anywhere.");
  };

  return (
    <main className="relative w-full h-[100dvh] bg-peaky-black overflow-hidden font-sans">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 20.1683, latitude: 41.1533, zoom: 7, pitch: 45 }}
        maxBounds={ALBANIA_BOUNDS}
        minZoom={6}
        mapStyle={MAP_STYLE}
        attributionControl={false}
      >
        {pulses.map((pulse) => {
          // VISUAL FADE EFFECT: Calculates exact age down to the millisecond
          const age = Date.now() - new Date(pulse.created_at).getTime();
          const lifeRemaining = Math.max(0, 1 - (age / MAX_AGE_MS));
          
          if (lifeRemaining === 0) return null; 

          return (
            <Marker key={pulse.id} longitude={pulse.lng} latitude={pulse.lat} anchor="center">
              <motion.div
                onClick={(e) => { e.stopPropagation(); handlePlayPulse(pulse); }}
                className="w-4 h-4 rounded-full bg-peaky-blood shadow-neon-blood cursor-pointer border border-black"
                style={{ opacity: 0.1 + (lifeRemaining * 0.9) }} // Fades as time passes
                animate={{ scale: [1, 1 + pulse.energy_value * 3 * lifeRemaining, 1] }}
                transition={{ duration: 1.5 - pulse.energy_value, repeat: Infinity, ease: "easeInOut" }}
              />
            </Marker>
          );
        })}
      </Map>

      <AnimatePresence>
        {activePulse && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute top-safe right-4 md:top-10 md:right-10 z-20 bg-peaky-charcoal border border-peaky-steel p-4 rounded-xl shadow-2xl flex items-center gap-4 text-white mt-4"
          >
            <Volume2 className="text-peaky-gold animate-pulse" size={24} />
            <div className="flex flex-col">
              <span className="text-xs text-gray-400 font-mono tracking-widest uppercase">Playing Pulse</span>
              <span className="text-sm font-bold">Energy: {(activePulse.energy_value * 100).toFixed(0)}%</span>
            </div>
            <button 
              onClick={() => handleShare(activePulse.id)}
              className="ml-4 p-2 bg-peaky-steel hover:bg-peaky-gold hover:text-black rounded-full transition-colors"
            >
              <Share2 size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-16 md:bottom-10 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-4 w-11/12 max-w-md pb-safe">
        {isRecording && (
          <div className="w-full flex flex-col items-center gap-2">
            <span className="text-peaky-blood font-mono text-xs tracking-widest uppercase animate-pulse drop-shadow-md">
              Recording Live...
            </span>
            <div className="w-full h-2 bg-peaky-charcoal rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-peaky-gold shadow-neon-gold"
                animate={{ width: `${liveEnergy * 100}%` }}
                transition={{ type: 'tween', duration: 0.1 }}
              />
            </div>
          </div>
        )}
        
        {isUploading ? (
          <button disabled className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm bg-peaky-steel text-gray-400 shadow-neon-gold animate-pulse flex items-center gap-2">
            Uploading to Cloud...
          </button>
        ) : isRecording ? (
          <button
            onClick={stopRecording}
            className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm transition-all duration-300 w-full sm:w-auto bg-white text-peaky-black hover:bg-gray-300 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.5)]"
          >
            <Square size={16} fill="currentColor" /> Stop Recording
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm transition-all duration-300 w-full sm:w-auto bg-peaky-blood text-white shadow-neon-blood hover:bg-red-700 hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
          >
            <Play size={16} fill="currentColor" /> Drop a Pulse
          </button>
        )}
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Suspense fallback={<div className="w-full h-screen bg-peaky-black flex justify-center items-center text-peaky-blood">Loading Map...</div>}>
      <MapEngine />
    </Suspense>
  );
}