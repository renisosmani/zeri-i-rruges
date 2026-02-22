'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Map, { Marker, MapRef } from 'react-map-gl/maplibre';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Play, Square, X, Flame, Radio } from 'lucide-react'; 
import { useAudioPulse } from '@/app/hooks/useAudioPulse';
import { supabase } from '@/utils/supabase'; 
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const ALBANIA_BOUNDS: [number, number, number, number] = [18.5, 39.5, 21.5, 43.0];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; 

const CITIES = [
  { name: 'Tirana', lat: 41.3275, lng: 19.8187 },
  { name: 'Durrësi', lat: 41.3246, lng: 19.4565 },
  { name: 'Shkodra', lat: 42.0693, lng: 19.5033 },
  { name: 'Vlora', lat: 40.4650, lng: 19.4850 },
  { name: 'Korça', lat: 40.6143, lng: 20.7778 },
  { name: 'Elbasani', lat: 41.1102, lng: 20.0867 },
  { name: 'Fieri', lat: 40.7239, lng: 19.5561 },
  { name: 'Berati', lat: 40.7086, lng: 19.9436 },
  { name: 'Gjirokastra', lat: 40.0673, lng: 20.1045 },
  { name: 'Saranda', lat: 39.8730, lng: 20.0059 },
  { name: 'Kukësi', lat: 42.0767, lng: 20.4219 },
  { name: 'Lezha', lat: 41.7836, lng: 19.6436 }
];

const PHRASES = [
  "{city} sapo lëshoi një zë të ri. Shko dëgjoje!",
  "Dikush në {city} ka diçka për të thënë.",
  "Zhurmë e re nga {city}...",
  "E dëgjove zërin e fundit në {city}?",
  "{city} theu heshtjen sapo."
];

type Pulse = { 
  id: string; lat: number; lng: number; energy_value: number; 
  audio_url: string; created_at: string; category: string; respect_count: number; 
};

function MapEngine() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activePulse, setActivePulse] = useState<Pulse | null>(null);
  const [uploadStep, setUploadStep] = useState<'idle' | 'recording' | 'category' | 'uploading'>('idle');
  const [respectedPulses, setRespectedPulses] = useState<string[]>([]);
  
  const [streetNews, setStreetNews] = useState<string | null>(null);
  const prevPulsesLength = useRef(0); 
  
  const mapRef = useRef<MapRef>(null);
  const searchParams = useSearchParams();
  const { isRecording, liveEnergy, peakEnergy, audioBlob, startRecording, stopRecording } = useAudioPulse();
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pannerRef = useRef<StereoPannerNode | null>(null);
  const currentAudioElement = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const savedRespects = JSON.parse(localStorage.getItem('respectedPulses') || '[]');
    setRespectedPulses(savedRespects);
  }, []);

  useEffect(() => {
    const fetchPulses = async () => {
      const yesterday = new Date(Date.now() - MAX_AGE_MS).toISOString();
      const { data, error } = await supabase
        .from('pulses')
        .select('*')
        .gte('created_at', yesterday); 
        
      if (data) setPulses(data);
    };

    fetchPulses();
    const interval = setInterval(fetchPulses, 15000); 
    return () => clearInterval(interval);
  }, []);

  
  useEffect(() => {
    
    if (prevPulsesLength.current === 0) {
      prevPulsesLength.current = pulses.length;
      return;
    }

    
    if (pulses.length > prevPulsesLength.current) {
      
      const newestPulse = pulses.reduce((latest, current) => 
        new Date(latest.created_at).getTime() > new Date(current.created_at).getTime() ? latest : current
      , pulses[0]);

      let nearestCity = "Diku në Shqipëri";
      let minDistance = 0.2; 

      CITIES.forEach(city => {
        const dist = Math.sqrt(Math.pow(city.lat - newestPulse.lat, 2) + Math.pow(city.lng - newestPulse.lng, 2));
        if (dist < minDistance) {
          minDistance = dist;
          nearestCity = city.name;
        }
      });

      const randomPhrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
      setStreetNews(randomPhrase.replace("{city}", nearestCity));

      
      const timer = setTimeout(() => {
        setStreetNews(null);
      }, 6000);

      prevPulsesLength.current = pulses.length;
      return () => clearTimeout(timer);
    }
    
    prevPulsesLength.current = pulses.length;
  }, [pulses]);

  useEffect(() => {
    const sharedId = searchParams.get('pulse');
    if (sharedId && pulses.length > 0) {
      const target = pulses.find(p => p.id === sharedId);
      if (target && mapRef.current) {
        mapRef.current.flyTo({ center: [target.lng, target.lat], zoom: 12, duration: 2000 });
      }
    }
  }, [searchParams, pulses]);

  useEffect(() => {
    if (isRecording) {
      setUploadStep('recording');
    } else if (uploadStep === 'recording' && audioBlob) {
      setUploadStep('category');
    }
  }, [isRecording, audioBlob, uploadStep]);

  const handleUploadWithCategory = async (selectedCategory: string) => {
    if (!audioBlob || peakEnergy === 0) return;
    setUploadStep('uploading');
    
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 15000, maximumAge: 0
        });
      });

      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.webm`;
      
      const { error: uploadError } = await supabase.storage
        .from('audio_pulses')
        .upload(fileName, audioBlob, { contentType: 'audio/webm', upsert: false });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('audio_pulses').getPublicUrl(fileName);

      const newPulse = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        energy_value: peakEnergy,
        audio_url: publicUrlData.publicUrl,
        category: selectedCategory,
        respect_count: 0
      };

      const { data: insertData, error: insertError } = await supabase
        .from('pulses').insert([newPulse]).select();

      if (insertError) throw insertError;
      
      
      if (insertData) setPulses(prev => [...prev, insertData[0]]);
      
      alert("Zëri yt u lëshua në rrugë!");
    } catch (error: any) {
      alert(`Gabim: ${error.message || "Ju lutem lejoni aksesin në Lokacion dhe Mikrofon!"}`);
    } finally {
      setUploadStep('idle');
    }
  };

  const handleGiveRespect = async (id: string) => {
    if (respectedPulses.includes(id)) return;

    const newRespectedList = [...respectedPulses, id];
    setRespectedPulses(newRespectedList);
    localStorage.setItem('respectedPulses', JSON.stringify(newRespectedList));

    const { error } = await supabase.rpc('increment_respect', { row_id: id });
    
    if (!error) {
      setPulses(prev => prev.map(p => 
        p.id === id ? { ...p, respect_count: (p.respect_count || 0) + 1 } : p
      ));
      
      if (activePulse && activePulse.id === id) {
        setActivePulse(prev => prev ? { ...prev, respect_count: (prev.respect_count || 0) + 1 } : null);
      }
    }
  };

  const handlePlayPulse = async (pulse: Pulse) => {
    setActivePulse(pulse);
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

      if (currentAudioElement.current) {
        currentAudioElement.current.pause();
        currentAudioElement.current.src = ""; 
      }

      const audio = new Audio();
      audio.crossOrigin = "anonymous"; 
      audio.src = pulse.audio_url;
      audio.load(); 
      currentAudioElement.current = audio;

      try {
        const source = audioCtxRef.current.createMediaElementSource(audio);
        const panner = audioCtxRef.current.createStereoPanner();
        source.connect(panner);
        panner.connect(audioCtxRef.current.destination);
        pannerRef.current = panner;

        if (mapRef.current) {
          const mapCenterLng = mapRef.current.getCenter().lng;
          panner.pan.value = Math.max(-1, Math.min(1, (pulse.lng - mapCenterLng) * 2)); 
        }
      } catch (e) { console.warn("Panner fallback", e); }

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => audio.play().catch(() => {}));
      }
      
      audio.onended = () => setActivePulse(null);
    } catch (err) { console.error("Playback Error:", err); }
  };

  const handleShare = (id: string) => {
    const url = `${window.location.origin}?pulse=${id}`;
    navigator.clipboard.writeText(url);
    alert("Linku i Pulsit u kopjua! Dërgoja miqve.");
  };

  return (
    <main className="relative w-full h-[100dvh] bg-peaky-black overflow-hidden font-sans">
      
      {/**/}
      <AnimatePresence mode="wait">
        {streetNews && (
          <motion.div
            key={streetNews} 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-peaky-charcoal/90 backdrop-blur-md border border-peaky-steel px-6 py-2 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center gap-3 w-max max-w-[90vw]"
          >
            <Radio size={16} className="text-peaky-blood animate-pulse" />
            <span className="text-white text-xs sm:text-sm font-mono tracking-wide">
              {streetNews}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <Map
        ref={mapRef}
        initialViewState={{ longitude: 20.1683, latitude: 41.1533, zoom: 7, pitch: 45 }}
        maxBounds={ALBANIA_BOUNDS}
        minZoom={6}
        mapStyle={MAP_STYLE}
        attributionControl={false}
      >
        {pulses.map((pulse) => {
          const age = Date.now() - new Date(pulse.created_at).getTime();
          const lifeRemaining = Math.max(0, 1 - (age / MAX_AGE_MS));
          if (lifeRemaining === 0) return null; 

          const respectLevel = pulse.respect_count || 0;
          const sizeIncrease = Math.min(respectLevel * 0.3, 8); 
          const dynamicSize = `${16 + sizeIncrease}px`; 

          const glowIncrease = Math.min(respectLevel * 1.5, 20); 
          const glowOpacity = 0.5 + Math.min(respectLevel * 0.02, 0.4); 
          const dynamicGlow = `0 0 ${10 + glowIncrease}px rgba(220, 38, 38, ${glowOpacity})`;

          return (
            <Marker key={pulse.id} longitude={pulse.lng} latitude={pulse.lat} anchor="bottom">
              <div className="flex flex-col items-center justify-end">
                <span 
                  className="text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.5)] z-10"
                  style={{ opacity: 0.3 + (lifeRemaining * 0.7) }}
                >
                  {pulse.category || '💬'}
                </span>
                
                <motion.div
                  onPointerDown={(e) => { e.stopPropagation(); handlePlayPulse(pulse); }}
                  className="rounded-full bg-peaky-blood cursor-pointer border-2 border-white -mt-2"
                  style={{ 
                    width: dynamicSize, 
                    height: dynamicSize,
                    boxShadow: dynamicGlow,
                    opacity: 0.1 + (lifeRemaining * 0.9) 
                  }}
                  animate={{ scale: [1, 1 + pulse.energy_value * 3 * lifeRemaining, 1] }}
                  transition={{ duration: 1.5 - pulse.energy_value, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </Marker>
          );
        })}
      </Map>

      <AnimatePresence>
        {activePulse && (
          <motion.div 
            initial={{ y: -50, opacity: 0 }} 
            animate={{ y: 0, opacity: 1 }} 
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-20 left-4 right-4 md:top-20 md:left-auto md:right-10 md:w-auto z-50 bg-peaky-charcoal/95 backdrop-blur-md border border-peaky-steel p-4 rounded-xl shadow-2xl flex items-center justify-between gap-4 text-white"
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl drop-shadow-md">{activePulse.category || '💬'}</span>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase">Duke luajtur</span>
                <span className="text-sm font-bold flex items-center gap-1">
                  {activePulse.respect_count || 0} <Flame size={14} className={activePulse.respect_count > 0 ? "text-orange-500" : "text-gray-500"} /> Respect
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleGiveRespect(activePulse.id)}
                disabled={respectedPulses.includes(activePulse.id)} 
                className={`p-3 rounded-full transition-all shadow-[0_0_15px_rgba(220,38,38,0.5)] ${
                  respectedPulses.includes(activePulse.id) 
                    ? 'bg-gray-600 cursor-not-allowed opacity-50' 
                    : 'bg-peaky-blood hover:bg-red-600 hover:scale-110' 
                }`}
              >
                🔥
              </button>

              <button onClick={() => handleShare(activePulse.id)} className="p-3 bg-peaky-steel hover:bg-peaky-gold hover:text-black rounded-full transition-colors">
                <Share2 size={16} />
              </button>

              <button 
                onClick={() => {
                  if (currentAudioElement.current) currentAudioElement.current.pause();
                  setActivePulse(null);
                }} 
                className="p-2 ml-1 text-gray-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-16 md:bottom-10 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-4 w-11/12 max-w-md pb-safe">
        
        {uploadStep === 'recording' && (
          <div className="w-full flex flex-col items-center gap-2">
            <span className="text-peaky-blood font-mono text-xs tracking-widest uppercase animate-pulse">Duke Regjistruar...</span>
            <div className="w-full h-2 bg-peaky-charcoal rounded-full overflow-hidden">
              <motion.div className="h-full bg-peaky-gold shadow-neon-gold" animate={{ width: `${liveEnergy * 100}%` }} transition={{ type: 'tween', duration: 0.1 }} />
            </div>
          </div>
        )}

        {uploadStep === 'category' && (
          <div className="w-full flex flex-col items-center gap-4 bg-peaky-charcoal/90 p-6 rounded-2xl border border-peaky-steel backdrop-blur-md shadow-2xl">
            <span className="text-white text-sm font-bold tracking-widest uppercase">Zgjidh Kategorinë:</span>
            <div className="flex gap-6">
              <button onClick={() => handleUploadWithCategory('💬')} className="flex flex-col items-center gap-1 hover:scale-110 transition-transform">
                <span className="text-4xl">💬</span>
                <span className="text-[10px] text-gray-300 uppercase">Muhabet</span>
              </button>
              <button onClick={() => handleUploadWithCategory('🎸')} className="flex flex-col items-center gap-1 hover:scale-110 transition-transform">
                <span className="text-4xl">🎸</span>
                <span className="text-[10px] text-gray-300 uppercase">Muzikë</span>
              </button>
              <button onClick={() => handleUploadWithCategory('🚨')} className="flex flex-col items-center gap-1 hover:scale-110 transition-transform">
                <span className="text-4xl">🚨</span>
                <span className="text-[10px] text-gray-300 uppercase">Lajm</span>
              </button>
            </div>
            <button onClick={() => setUploadStep('idle')} className="text-gray-400 text-xs uppercase underline mt-4">
              Anulo (Fshi Zërin)
            </button>
          </div>
        )}

        {uploadStep === 'uploading' && (
          <button disabled className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm bg-peaky-steel text-gray-400 shadow-neon-gold animate-pulse flex items-center gap-2">
            Duke u ngarkuar...
          </button>
        )}
        
        {uploadStep === 'recording' && (
          <button onClick={stopRecording} className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm transition-all bg-white text-peaky-black hover:bg-gray-300 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.5)]">
            <Square size={16} fill="currentColor" /> Stop & Zgjidh
          </button>
        )}
        
        {uploadStep === 'idle' && (
          <button onClick={startRecording} className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm transition-all bg-peaky-blood text-white shadow-neon-blood hover:bg-red-700 hover:scale-105 active:scale-95 flex items-center justify-center gap-2">
            <Play size={16} fill="currentColor" /> Drop a Pulse
          </button>
        )}
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Suspense fallback={<div className="w-full h-screen bg-peaky-black flex justify-center items-center text-peaky-blood tracking-widest font-mono text-sm uppercase">Loading Map...</div>}>
      <MapEngine />
    </Suspense>
  );
}
