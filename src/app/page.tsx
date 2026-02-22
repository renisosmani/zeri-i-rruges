'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Map, { Marker, MapRef } from 'react-map-gl/maplibre';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Play, Square, X, Flame, Radio, List, Trash2, MapPin, Clock } from 'lucide-react'; 
import { useAudioPulse } from '@/app/hooks/useAudioPulse';
import { supabase } from '@/utils/supabase'; 
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const ALBANIA_BOUNDS: [number, number, number, number] = [18.5, 39.5, 21.5, 43.0];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; 

const CITIES = [
  { name: 'Tiranë', lat: 41.3275, lng: 19.8187 },
  { name: 'Durrës', lat: 41.3246, lng: 19.4565 },
  { name: 'Shkodër', lat: 42.0693, lng: 19.5033 },
  { name: 'Vlorë', lat: 40.4650, lng: 19.4850 },
  { name: 'Korçë', lat: 40.6143, lng: 20.7778 },
  { name: 'Elbasan', lat: 41.1102, lng: 20.0867 },
  { name: 'Fier', lat: 40.7239, lng: 19.5561 },
  { name: 'Berat', lat: 40.7086, lng: 19.9436 },
  { name: 'Gjirokastër', lat: 40.0673, lng: 20.1045 },
  { name: 'Sarandë', lat: 39.8730, lng: 20.0059 },
  { name: 'Kukës', lat: 42.0767, lng: 20.4219 },
  { name: 'Lezhë', lat: 41.7836, lng: 19.6436 }
];

const PHRASES = [
  "{city} sapo lëshoi një zë të ri. Shko dëgjoje!",
  "Dikush në {city} ka diçka për të thënë.",
  "Zhurmë e re nga {city}...",
  "{city} theu heshtjen sapo."
];

const getMoodStyle = (energy: number) => {
  if (energy >= 0.7) return { color: '#ef4444', shadowRgb: '239, 68, 68' };
  if (energy >= 0.4) return { color: '#a855f7', shadowRgb: '168, 85, 247' };
  return { color: '#3b82f6', shadowRgb: '59, 130, 246' };
};

const getTimeAgo = (dateString: string) => {
  const now = new Date().getTime();
  const past = new Date(dateString).getTime();
  const diffMins = Math.round((now - past) / 60000);
  
  if (diffMins < 1) return 'Sapo u hodh';
  if (diffMins < 60) return `Para ${diffMins} min`;
  const diffHrs = Math.floor(diffMins / 60);
  return `Para ${diffHrs} orësh`;
};

const getNearestCity = (lat: number, lng: number) => {
  let nearest = "Diku në Shqipëri";
  let minDistance = 0.2; 
  CITIES.forEach(c => {
    const d = Math.sqrt(Math.pow(c.lat - lat, 2) + Math.pow(c.lng - lng, 2));
    if (d < minDistance) {
      minDistance = d;
      nearest = c.name;
    }
  });
  return nearest;
};

type Pulse = { 
  id: string; lat: number; lng: number; energy_value: number; 
  audio_url: string; created_at: string; category: string; respect_count: number; 
};

function MapEngine() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activePulse, setActivePulse] = useState<Pulse | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null); // Mban sekondat e zërit
  const [uploadStep, setUploadStep] = useState<'idle' | 'recording' | 'category' | 'uploading'>('idle');
  
  const [respectedPulses, setRespectedPulses] = useState<string[]>([]);
  const [myPulses, setMyPulses] = useState<string[]>([]); 
  const [showFeed, setShowFeed] = useState(false);
  const [reactions, setReactions] = useState<{id: number, emoji: string}[]>([]);
  
  const [streetNews, setStreetNews] = useState<string | null>(null);
  const prevPulsesLength = useRef(0); 
  
  const mapRef = useRef<MapRef>(null);
  const searchParams = useSearchParams();
  const { isRecording, liveEnergy, peakEnergy, audioBlob, startRecording, stopRecording } = useAudioPulse();
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentAudioElement = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const savedRespects = JSON.parse(localStorage.getItem('respectedPulses') || '[]');
    const savedMine = JSON.parse(localStorage.getItem('myPulses') || '[]');
    setRespectedPulses(savedRespects);
    setMyPulses(savedMine);
  }, []);

  useEffect(() => {
    const fetchPulses = async () => {
      const yesterday = new Date(Date.now() - MAX_AGE_MS).toISOString();
      const { data } = await supabase.from('pulses').select('*').gte('created_at', yesterday).order('created_at', { ascending: false });
      if (data) setPulses(data);
    };
    fetchPulses();
    const interval = setInterval(fetchPulses, 15000); 
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (prevPulsesLength.current !== 0 && pulses.length > prevPulsesLength.current) {
      const newest = pulses[0];
      const nearestCity = getNearestCity(newest.lat, newest.lng);
      setStreetNews(PHRASES[Math.floor(Math.random()*PHRASES.length)].replace("{city}", nearestCity));
      setTimeout(() => setStreetNews(null), 6000);
    }
    prevPulsesLength.current = pulses.length;
  }, [pulses]);

  const handleUploadWithCategory = async (cat: string) => {
    if (!audioBlob || peakEnergy === 0) return;
    setUploadStep('uploading');
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 });
      });
      const fileName = `${Date.now()}.webm`;
      await supabase.storage.from('audio_pulses').upload(fileName, audioBlob, { contentType: 'audio/webm' });
      const { data: url } = supabase.storage.from('audio_pulses').getPublicUrl(fileName);
      const { data } = await supabase.from('pulses').insert([{
        lat: pos.coords.latitude, lng: pos.coords.longitude, energy_value: peakEnergy,
        audio_url: url.publicUrl, category: cat, respect_count: 0
      }]).select();
      
      if (data) {
        setPulses(prev => [data[0], ...prev]);
        const newMyPulses = [...myPulses, data[0].id];
        setMyPulses(newMyPulses);
        localStorage.setItem('myPulses', JSON.stringify(newMyPulses));
      }
    } catch (e) { alert("Pati një problem me ngarkimin e zërit."); }
    setUploadStep('idle');
  };

  const handleDeleteMyPulse = async (pulseId: string, audioUrl: string) => {
    if (!confirm("Je i sigurt që do ta fshish këtë zë përgjithmonë?")) return;
    if (currentAudioElement.current) currentAudioElement.current.pause();
    setActivePulse(null);

    await supabase.from('pulses').delete().eq('id', pulseId);
    
    const fileName = audioUrl.split('/').pop();
    if (fileName) await supabase.storage.from('audio_pulses').remove([fileName]);

    setPulses(prev => prev.filter(p => p.id !== pulseId));
    
    const updatedMyPulses = myPulses.filter(id => id !== pulseId);
    setMyPulses(updatedMyPulses);
    localStorage.setItem('myPulses', JSON.stringify(updatedMyPulses));
  };

  const handleGiveRespect = async (id: string) => {
    if (respectedPulses.includes(id)) return;
    const newRespectedList = [...respectedPulses, id];
    setRespectedPulses(newRespectedList);
    localStorage.setItem('respectedPulses', JSON.stringify(newRespectedList));

    const { error } = await supabase.rpc('increment_respect', { row_id: id });
    if (!error) {
      setPulses(prev => prev.map(p => p.id === id ? { ...p, respect_count: (p.respect_count || 0) + 1 } : p));
      if (activePulse && activePulse.id === id) {
        setActivePulse(prev => prev ? { ...prev, respect_count: (prev.respect_count || 0) + 1 } : null);
      }
    }
  };

  const addReaction = (emoji: string) => {
    const id = Date.now();
    setReactions(prev => [...prev, { id, emoji }]);
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2000);
  };

  const handlePlayPulse = async (pulse: Pulse) => {
    setActivePulse(pulse);
    setAudioDuration(null); 
    if (showFeed) setShowFeed(false);
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
      if (currentAudioElement.current) { currentAudioElement.current.pause(); }
      
      const audio = new Audio(pulse.audio_url);
      audio.crossOrigin = "anonymous";
      
     
      audio.addEventListener('loadedmetadata', () => {
        setAudioDuration(audio.duration);
      });

      currentAudioElement.current = audio;
      audio.play();
      audio.onended = () => setActivePulse(null);
    } catch (err) { console.error(err); }
  };

  return (
    <main className="relative w-full h-[100dvh] bg-peaky-black overflow-hidden font-sans select-none">
      
      <AnimatePresence>
        {streetNews && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-peaky-charcoal/90 border border-peaky-steel px-6 py-2 rounded-full text-white text-xs font-mono flex items-center gap-2">
            <Radio size={14} className="text-peaky-blood animate-pulse" /> {streetNews}
          </motion.div>
        )}
      </AnimatePresence>

      <Map ref={mapRef} initialViewState={{ longitude: 20.1683, latitude: 41.1533, zoom: 7, pitch: 45 }} maxBounds={ALBANIA_BOUNDS} mapStyle={MAP_STYLE} attributionControl={false}>
        {pulses.map((pulse) => {
          const age = Date.now() - new Date(pulse.created_at).getTime();
          const life = Math.max(0, 1 - (age / MAX_AGE_MS));
          const mood = getMoodStyle(pulse.energy_value);
          const size = `${16 + Math.min(pulse.respect_count * 0.3, 8)}px`;
          const isActive = activePulse?.id === pulse.id;

          return (
            <Marker key={pulse.id} longitude={pulse.lng} latitude={pulse.lat} anchor="bottom">
              <div className="flex flex-col items-center relative">
                <span className="text-2xl mb-1" style={{ opacity: 0.3 + (life * 0.7) }}>{pulse.category}</span>
                {isActive && (
                   <div className="absolute bottom-0 flex items-center justify-center pointer-events-none">
                    {[1, 2].map(i => (
                      <motion.div key={i} className="absolute rounded-full border-2" style={{ borderColor: mood.color }}
                        initial={{ width: 10, height: 10, opacity: 1 }} animate={{ width: 60, height: 60, opacity: 0 }} transition={{ duration: 1.5, repeat: Infinity, delay: i*0.5 }} />
                    ))}
                   </div>
                )}
                <motion.div onPointerDown={() => handlePlayPulse(pulse)} className="rounded-full border-2 border-white cursor-pointer"
                  style={{ backgroundColor: mood.color, width: size, height: size, boxShadow: `0 0 15px ${mood.color}`, opacity: 0.2 + (life * 0.8) }} />
              </div>
            </Marker>
          );
        })}
      </Map>

      <div className="absolute bottom-40 right-10 pointer-events-none z-50">
        <AnimatePresence>
          {reactions.map(r => (
            <motion.span key={r.id} initial={{ y: 0, opacity: 1, x: 0 }} animate={{ y: -200, opacity: 0, x: (Math.random()-0.5)*50 }} exit={{ opacity: 0 }}
              className="absolute text-3xl">{r.emoji}</motion.span>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showFeed && (
          <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
            className="absolute inset-y-0 left-0 w-80 bg-peaky-charcoal/95 backdrop-blur-xl z-[60] border-r border-peaky-steel p-6 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-white font-bold tracking-widest uppercase text-sm">Zërat e Fundit</h2>
              <X onClick={() => setShowFeed(false)} className="text-gray-400 cursor-pointer" />
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              {pulses.map(p => (
                <div key={p.id} onClick={() => handlePlayPulse(p)} className="p-3 bg-peaky-black/50 border border-peaky-steel rounded-lg cursor-pointer hover:border-peaky-gold transition-colors flex items-center gap-3">
                  <span className="text-2xl">{p.category}</span>
                  <div className="flex-1">
                    <div className="text-[10px] text-gray-400 font-mono">{getTimeAgo(p.created_at)}</div>
                    <div className="text-white text-xs font-bold flex items-center gap-1">{p.respect_count} <Flame size={10} className="text-orange-500"/> Respect</div>
                  </div>
                  <Play size={12} className="text-peaky-gold" />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activePulse && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}
            className="absolute top-16 left-4 right-4 md:left-auto md:right-10 md:w-auto min-w-[300px] z-50 bg-peaky-charcoal/95 border border-peaky-steel p-5 rounded-2xl shadow-2xl">
            
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <span className="text-4xl drop-shadow-md">{activePulse.category}</span>
                <div className="text-white flex flex-col gap-1">
                  
                  {/*  */}
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                    <span className="flex items-center gap-1 bg-peaky-black/50 px-2 py-1 rounded-md">
                      <MapPin size={12} className="text-peaky-gold"/> {getNearestCity(activePulse.lat, activePulse.lng)}
                    </span>
                    {audioDuration && (
                      <span className="flex items-center gap-1 bg-peaky-black/50 px-2 py-1 rounded-md">
                        <Clock size={12} className="text-blue-400"/> {Math.round(audioDuration)}s
                      </span>
                    )}
                  </div>

                  {/*  */}
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">
                    {getTimeAgo(activePulse.created_at)}
                  </div>

                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                {/**/}
                {myPulses.includes(activePulse.id) && (
                  <button onClick={() => handleDeleteMyPulse(activePulse.id, activePulse.audio_url)} className="p-2 bg-red-900/40 hover:bg-red-600 text-white rounded-full transition-colors" title="Fshi zërin tënd">
                    <Trash2 size={16} />
                  </button>
                )}
                <X onClick={() => setActivePulse(null)} className="text-gray-500 hover:text-white cursor-pointer p-1" size={24} />
              </div>
            </div>
            
            <div className="flex items-center justify-between bg-peaky-black/40 p-2 rounded-xl border border-peaky-steel/50">
              
              {/* */}
              <button 
                onClick={() => handleGiveRespect(activePulse.id)}
                disabled={respectedPulses.includes(activePulse.id)} 
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  respectedPulses.includes(activePulse.id) 
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
                    : 'bg-peaky-blood text-white hover:bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.4)]' 
                }`}
              >
                <Flame size={16} className={respectedPulses.includes(activePulse.id) ? "text-gray-500" : "text-orange-400"}/> 
                {activePulse.respect_count || 0}
              </button>

              {/**/}
              <div className="flex gap-4 px-2">
                {['😂', '💀', '🚨'].map(e => (
                  <button key={e} onClick={() => addReaction(e)} className="text-xl hover:scale-125 transition-transform">{e}</button>
                ))}
              </div>
              
              {/* */}
              <button onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}?pulse=${activePulse.id}`);
                alert("Linku u kopjua!");
              }} className="p-2 text-gray-400 hover:text-white transition-colors">
                <Share2 size={18} />
              </button>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 w-11/12 max-w-md">
        <button onClick={() => setShowFeed(true)} className="p-4 bg-peaky-charcoal border border-peaky-steel rounded-full text-white hover:bg-peaky-steel transition-colors shadow-xl">
          <List size={24} />
        </button>
        
        <div className="flex-1 relative">
          {isRecording && (
            <div className="absolute -top-10 left-0 right-0 flex justify-center">
               <motion.div className="h-1 bg-peaky-gold shadow-neon-gold rounded-full" animate={{ width: `${liveEnergy * 100}%` }} />
            </div>
          )}
          
          {uploadStep === 'category' ? (
             <div className="flex justify-around bg-peaky-charcoal/90 p-2 rounded-full border border-peaky-steel shadow-2xl">
                {['💬', '🎸', '🚨'].map(c => <button key={c} onClick={() => handleUploadWithCategory(c)} className="text-2xl hover:scale-110 p-2">{c}</button>)}
             </div>
          ) : (
            <button onClick={isRecording ? stopRecording : startRecording} 
              className={`w-full py-4 rounded-full font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all ${isRecording ? 'bg-white text-black animate-pulse' : 'bg-peaky-blood text-white shadow-neon-blood hover:bg-red-700'}`}>
              {isRecording ? <Square size={16} fill="black"/> : <Play size={16} fill="white"/>}
              {isRecording ? 'Stop & Zgjidh' : 'Lësho Zërin'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

export default function App() {
  return <Suspense fallback={<div className="w-full h-screen bg-peaky-black"></div>}><MapEngine /></Suspense>;
}
