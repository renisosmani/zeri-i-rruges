'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Map, { Marker, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import useSupercluster from 'use-supercluster';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Play, Square, X, Flame, Radio, List, Trash2, MapPin, Clock, Users, ChevronRight, MessageCircle } from 'lucide-react'; 
import { useAudioPulse } from '@/app/hooks/useAudioPulse';
import { supabase } from '@/utils/supabase'; 
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const ALBANIA_BOUNDS: [number, number, number, number] = [18.5, 39.5, 21.5, 43.0];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; 

const CITIES = [
  { name: 'Tiranë', lat: 41.3275, lng: 19.8187 }, { name: 'Durrës', lat: 41.3246, lng: 19.4565 },
  { name: 'Shkodër', lat: 42.0693, lng: 19.5033 }, { name: 'Vlorë', lat: 40.4650, lng: 19.4850 },
  { name: 'Korçë', lat: 40.6143, lng: 20.7778 }, { name: 'Elbasan', lat: 41.1102, lng: 20.0867 }
];


const CITY_PHRASES: Record<string, string> = {
  'Tiranë': 'Po bëhet nami në Tiranë 🔥',
  'Durrës': 'Durrësi po flet 🌊',
  'Shkodër': 'Shkodra ka diçka për të thënë 🚲',
  'Vlorë': 'Vlora po nxeh situatën 🌴',
  'Korçë': 'Korça po zjen 🍎',
  'Elbasan': 'Elbasani u ndez 🏭'
};

const NEON_COLORS = ['#f43f5e', '#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6'];
const getColorFromId = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return NEON_COLORS[Math.abs(hash) % NEON_COLORS.length];
};

const getMoodStyle = (energy: number) => {
  if (energy >= 0.7) return { color: '#ef4444', shadowRgb: '239, 68, 68' };
  if (energy >= 0.4) return { color: '#a855f7', shadowRgb: '168, 85, 247' };
  return { color: '#3b82f6', shadowRgb: '59, 130, 246' };
};

const getTimeAgo = (dateString: string) => {
  const diffMins = Math.round((new Date().getTime() - new Date(dateString).getTime()) / 60000);
  if (diffMins < 1) return 'Sapo';
  if (diffMins < 60) return `${diffMins}m`;
  return `${Math.floor(diffMins / 60)}h`;
};

const getNearestCity = (lat: number, lng: number) => {
  let nearest = "Diku"; let minDistance = 0.2;
  CITIES.forEach(c => {
    const d = Math.sqrt(Math.pow(c.lat - lat, 2) + Math.pow(c.lng - lng, 2));
    if (d < minDistance) { minDistance = d; nearest = c.name; }
  });
  return nearest;
};

type Pulse = { id: string; lat: number; lng: number; energy_value: number; audio_url: string; created_at: string; category: string; respect_count: number; parent_id?: string | null; };

function MapEngine() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activePulse, setActivePulse] = useState<Pulse | null>(null);
  const [activeCluster, setActiveCluster] = useState<Pulse[] | null>(null);
  const [replyTo, setReplyTo] = useState<Pulse | null>(null);
  
  
  const [trendingMsg, setTrendingMsg] = useState<string | null>(null);
  const lastTrendingState = useRef<string>('');
  
  const [bounds, setBounds] = useState<[number, number, number, number] | undefined>(undefined);
  const [zoom, setZoom] = useState(7);
  
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [uploadStep, setUploadStep] = useState<'idle' | 'recording' | 'category' | 'uploading'>('idle');
  const [myPulses, setMyPulses] = useState<string[]>([]); 
  const [respectedPulses, setRespectedPulses] = useState<string[]>([]);
  
  const mapRef = useRef<MapRef>(null);
  const { isRecording, liveEnergy, peakEnergy, audioBlob, startRecording, stopRecording } = useAudioPulse();
  
  useEffect(() => {
    if (audioBlob) {
      setUploadStep('category');
    }
  }, [audioBlob]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentAudioElement = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setMyPulses(JSON.parse(localStorage.getItem('myPulses') || '[]'));
    setRespectedPulses(JSON.parse(localStorage.getItem('respectedPulses') || '[]'));
    
    const fetchPulses = async () => {
      const yesterday = new Date(Date.now() - MAX_AGE_MS).toISOString();
      const { data } = await supabase.from('pulses').select('*').gte('created_at', yesterday).order('created_at', { ascending: false });
      
      if (data) {
        const now = Date.now();
        const validPulses = data.filter(p => {
          const age = now - new Date(p.created_at).getTime();
          if (p.category === '👻') {
            return age <= 2 * 60 * 60 * 1000; 
          }
          return true;
        });
        setPulses(validPulses);
      }
    };
    
    fetchPulses();
    const interval = setInterval(fetchPulses, 15000); 
    return () => clearInterval(interval);
  }, []);

  
  useEffect(() => {
    if (pulses.length === 0) return;
    const counts: Record<string, number> = {};
    pulses.forEach(p => {
      const city = getNearestCity(p.lat, p.lng);
      if (city !== 'Diku') counts[city] = (counts[city] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0 && sorted[0][1] >= 2) {
      const topCity = sorted[0][0];
      const pulseCount = sorted[0][1];
      const currentState = `${topCity}-${pulseCount}`;

      
      if (lastTrendingState.current !== currentState) {
        lastTrendingState.current = currentState;
        setTrendingMsg(CITY_PHRASES[topCity] || `Po bëhet nami në ${topCity} 🔥`);

        
        const timer = setTimeout(() => {
          setTrendingMsg(null);
        }, 6000);

        return () => clearTimeout(timer);
      }
    }
  }, [pulses]);

  const points = pulses.map(pulse => ({
    type: 'Feature' as const,
    properties: { cluster: false, ...pulse },
    geometry: { type: 'Point' as const, coordinates: [pulse.lng, pulse.lat] as [number, number] }
  }));

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds,
    zoom,
    options: { radius: 60, maxZoom: 15 } 
  });

  const lineData = {
    type: 'FeatureCollection' as const,
    features: pulses.filter(p => p.parent_id).map(child => {
      const parent = pulses.find(p => p.id === child.parent_id);
      if (!parent) return null;
      return {
        type: 'Feature' as const,
        properties: { color: getColorFromId(parent.id) },
        geometry: {
          type: 'LineString' as const,
          coordinates: [[child.lng, child.lat], [parent.lng, parent.lat]]
        }
      };
    }).filter(Boolean) as any
  };

  const updateMapBounds = () => {
    if (mapRef.current) {
      const b = mapRef.current.getMap().getBounds();
      setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      setZoom(mapRef.current.getMap().getZoom());
    }
  };

  const handlePlayPulse = async (pulse: Pulse) => {
    setActivePulse(pulse); setAudioDuration(null);
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
      if (currentAudioElement.current) currentAudioElement.current.pause();
      
      const audio = new Audio(pulse.audio_url);
      audio.crossOrigin = "anonymous";
      audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration));
      currentAudioElement.current = audio;
      audio.play();
      audio.onended = () => setActivePulse(null);
    } catch (err) { console.error(err); }
  };

  const handleUploadWithCategory = async (cat: string) => {
    if (!audioBlob) {
      alert("⚠️ Zëri nuk u regjistrua. Provo sërish!");
      setReplyTo(null);
      return;
    }
    
    setUploadStep('uploading');
    
    let lat = 41.3275; 
    let lng = 19.8187;
    let isGhost = false;

    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 5000 });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch (error) {
      isGhost = true;
      lat = 41.3275 + (Math.random() - 0.5) * 0.1; 
      lng = 19.8187 + (Math.random() - 0.5) * 0.1;
    }
    
    try {
      const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const fileName = `${Date.now()}.${ext}`;

      const { data: storageData, error: storageError } = await supabase.storage.from('audio_pulses').upload(fileName, audioBlob, { contentType: audioBlob.type });
      
      if (storageError) {
        alert(`⚠️ Gabim në ruajtjen e zërit! Error: ${storageError.message}`);
        setUploadStep('idle');
        setReplyTo(null);
        return;
      }

      const { data: url } = supabase.storage.from('audio_pulses').getPublicUrl(fileName);
      const finalCategory = isGhost ? '👻' : cat;

      const { data, error: dbError } = await supabase.from('pulses').insert([{ 
        lat: lat, lng: lng, energy_value: peakEnergy || 0.5, 
        audio_url: url.publicUrl, category: finalCategory, respect_count: 0,
        parent_id: replyTo ? replyTo.id : null 
      }]).select();
      
      if (dbError) {
        alert(`⚠️ Gabim në databazë! Error: ${dbError.message}`);
        setUploadStep('idle');
        setReplyTo(null);
        return;
      }
      
      if (data) {
        setPulses(prev => [data[0], ...prev]);
        const newMyPulses = [...myPulses, data[0].id];
        setMyPulses(newMyPulses); localStorage.setItem('myPulses', JSON.stringify(newMyPulses));
        
        if (isGhost) {
          alert("👻 GPS ishte i fikur! Zëri yt u lëshua si 'Fantazmë' dhe do të zhduket pas 2 orësh!");
        }
      }
    } catch (error) {
      alert("⚠️ Ndodhi një problem i panjohur. Provo sërish.");
    }
    
    setUploadStep('idle');
    setReplyTo(null);
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
    setRespectedPulses(newRespectedList); localStorage.setItem('respectedPulses', JSON.stringify(newRespectedList));
    const { error } = await supabase.rpc('increment_respect', { row_id: id });
    if (!error) {
      setPulses(prev => prev.map(p => p.id === id ? { ...p, respect_count: (p.respect_count || 0) + 1 } : p));
      if (activePulse?.id === id) setActivePulse(prev => prev ? { ...prev, respect_count: (prev.respect_count || 0) + 1 } : null);
      if (activeCluster) setActiveCluster(prev => prev ? prev.map(p => p.id === id ? { ...p, respect_count: (p.respect_count || 0) + 1 } : p) : null);
    }
  };

  return (
    <main className="relative w-full h-[100dvh] bg-peaky-black overflow-hidden font-sans select-none">
      
      {/**/}
      <AnimatePresence>
        {trendingMsg && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}
            className="absolute top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
            <div className="bg-peaky-blood/90 backdrop-blur-md border border-red-500 text-white text-xs sm:text-sm px-5 py-2.5 rounded-full flex items-center gap-2 shadow-[0_0_20px_rgba(220,38,38,0.6)] font-bold tracking-widest uppercase">
              <Radio size={16} className="text-peaky-gold animate-pulse"/>
              {trendingMsg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Map ref={mapRef} initialViewState={{ longitude: 20.1683, latitude: 41.1533, zoom: 7, pitch: 45 }} 
           maxBounds={ALBANIA_BOUNDS} mapStyle={MAP_STYLE} attributionControl={false}
           onMove={updateMapBounds} onLoad={updateMapBounds}>
        
        <Source id="lasers" type="geojson" data={lineData}>
          <Layer 
            id="laser-lines" 
            type="line" 
            paint={{ 
              'line-color': ['get', 'color'], 
              'line-width': 2.5, 
              'line-opacity': 0.8,
              'line-dasharray': [2, 2] 
            }} 
          />
        </Source>

        {clusters.map(cluster => {
          const [longitude, latitude] = cluster.geometry.coordinates;
          const { cluster: isCluster, point_count: pointCount } = cluster.properties as any;

          if (isCluster) {
            return (
              <Marker key={`cluster-${cluster.id}`} longitude={longitude} latitude={latitude}>
                <motion.div 
                  onClick={() => {
                    const leaves = supercluster?.getLeaves(cluster.id as number, Infinity) || [];
                    setActiveCluster(leaves.map(l => l.properties as Pulse).sort((a,b) => b.respect_count - a.respect_count));
                  }}
                  className="relative flex items-center justify-center cursor-pointer group"
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                >
                  <div className="absolute inset-0 bg-peaky-blood/30 rounded-full animate-ping" style={{ padding: `${20 + (pointCount * 2)}px` }} />
                  <div className="relative z-10 bg-peaky-charcoal border-2 border-peaky-blood shadow-[0_0_30px_rgba(220,38,38,0.6)] rounded-full flex flex-col items-center justify-center text-white"
                       style={{ width: `${40 + (pointCount * 2)}px`, height: `${40 + (pointCount * 2)}px` }}>
                    <Users size={16} className="text-peaky-gold mb-1" />
                    <span className="font-bold text-sm leading-none">{pointCount}</span>
                  </div>
                </motion.div>
              </Marker>
            );
          }

          const pulse = cluster.properties as Pulse;
          const mood = getMoodStyle(pulse.energy_value);
          const size = `${16 + Math.min(pulse.respect_count * 0.3, 8)}px`;

          return (
            <Marker key={pulse.id} longitude={longitude} latitude={latitude} anchor="bottom">
              <div className="flex flex-col items-center relative cursor-pointer" onClick={() => handlePlayPulse(pulse)}>
                <span className="text-2xl mb-1">{pulse.category}</span>
                {activePulse?.id === pulse.id && (
                   <div className="absolute bottom-0 flex items-center justify-center pointer-events-none">
                    {[1, 2].map(i => (
                      <motion.div key={i} className="absolute rounded-full border-2" style={{ borderColor: mood.color }}
                        initial={{ width: 10, height: 10, opacity: 1 }} animate={{ width: 60, height: 60, opacity: 0 }} transition={{ duration: 1.5, repeat: Infinity, delay: i*0.5 }} />
                    ))}
                   </div>
                )}
                <div className="rounded-full border-2 border-white" style={{ backgroundColor: mood.color, width: size, height: size, boxShadow: `0 0 15px ${mood.color}` }} />
              </div>
            </Marker>
          );
        })}
      </Map>

      <AnimatePresence>
        {activePulse && !activeCluster && (
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-sm bg-peaky-charcoal/95 backdrop-blur-xl border border-peaky-steel shadow-[0_10px_40px_rgba(0,0,0,0.8)] p-4 rounded-3xl flex items-center gap-4">
            
            <div className="text-4xl drop-shadow-lg">{activePulse.category}</div>
            
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-400 font-mono flex items-center gap-1"><Clock size={10}/> {getTimeAgo(activePulse.created_at)}</span>
                {audioDuration && <span className="text-xs text-peaky-gold font-bold">{Math.round(audioDuration)}s</span>}
              </div>
              
              <div className="flex items-center gap-2 mt-2">
                <button onClick={(e) => { e.stopPropagation(); handleGiveRespect(activePulse.id); }} className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-md transition-all ${respectedPulses.includes(activePulse.id) ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                  <Flame size={12} className={respectedPulses.includes(activePulse.id) ? 'fill-current' : ''}/> {activePulse.respect_count}
                </button>

                <button onClick={(e) => { e.stopPropagation(); setReplyTo(activePulse); startRecording(); }} className="p-1 bg-blue-900/30 rounded-md text-blue-400 hover:bg-blue-900/60 hover:text-blue-300">
                  <MessageCircle size={14}/>
                </button>
                
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?pulse=${activePulse.id}`); alert("Linku u kopjua!"); }} className="p-1 bg-gray-800 rounded-md text-gray-400 hover:text-white">
                  <Share2 size={14}/>
                </button>

                {myPulses.includes(activePulse.id) && (
                  <button onClick={() => handleDeleteMyPulse(activePulse.id, activePulse.audio_url)} className="p-1 bg-red-900/30 rounded-md text-red-400 hover:bg-red-900/60 hover:text-red-300 ml-auto">
                    <Trash2 size={14}/>
                  </button>
                )}
              </div>
            </div>

            <button onClick={() => { if (currentAudioElement.current) currentAudioElement.current.pause(); setActivePulse(null); }} className="w-10 h-10 bg-peaky-blood text-white rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(220,38,38,0.4)]">
              <Square size={14} fill="currentColor"/>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeCluster && activeCluster.length > 0 && (
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute bottom-0 left-0 right-0 md:left-auto md:right-10 md:bottom-10 md:w-96 md:rounded-3xl z-50 bg-peaky-charcoal/95 backdrop-blur-2xl border-t md:border border-peaky-steel shadow-[0_-10px_40px_rgba(0,0,0,0.8)] flex flex-col max-h-[70vh] rounded-t-3xl overflow-hidden">
            
            <div className="p-5 border-b border-peaky-steel/50 flex justify-between items-center bg-black/20">
              <div className="flex flex-col">
                <span className="flex items-center gap-2 text-peaky-gold text-xs font-mono uppercase tracking-widest"><Radio size={12} className="animate-pulse"/> Lagja Live</span>
                <h2 className="text-white text-xl font-bold flex items-center gap-2 mt-1">
                  <MapPin size={18} className="text-peaky-blood"/> {activeCluster[0] ? getNearestCity(activeCluster[0].lat, activeCluster[0].lng) : 'Diku'}
                </h2>
              </div>
              <button onClick={() => setActiveCluster(null)} className="p-2 bg-gray-800 rounded-full text-gray-400 hover:text-white"><X size={20}/></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {activeCluster.map((p, index) => {
                const isKing = index === 0 && p.respect_count > 0; 
                const isPlaying = activePulse?.id === p.id;

                return (
                  <motion.div key={p.id} onClick={() => handlePlayPulse(p)}
                    className={`p-4 rounded-2xl cursor-pointer transition-all border ${isPlaying ? 'bg-peaky-blood/20 border-peaky-blood' : 'bg-peaky-black/50 border-peaky-steel hover:border-peaky-gold'} flex items-center gap-4 relative overflow-hidden`}
                  >
                    {isKing && <div className="absolute top-0 right-0 bg-gradient-to-l from-yellow-500/20 to-transparent w-32 h-full pointer-events-none" />}
                    
                    <div className="relative">
                      <span className="text-3xl drop-shadow-lg">{p.category}</span>
                      {isKing && <span className="absolute -top-3 -right-2 text-xl drop-shadow-[0_0_10px_gold]">👑</span>}
                    </div>

                    <div className="flex-1 z-10">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1"><Clock size={8}/> {getTimeAgo(p.created_at)}</span>
                        {isKing && <span className="text-[9px] uppercase tracking-widest text-peaky-gold font-bold bg-peaky-gold/10 px-2 py-0.5 rounded-sm">Mbreti</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); handleGiveRespect(p.id); }} className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-md ${respectedPulses.includes(p.id) ? 'text-gray-500 bg-gray-800/50' : 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20'}`}>
                          <Flame size={12}/> {p.respect_count}
                        </button>
                        
                        <button onClick={(e) => { e.stopPropagation(); setReplyTo(p); startRecording(); setActiveCluster(null); }} className="p-1 text-blue-400 hover:text-blue-300">
                          <MessageCircle size={14}/>
                        </button>

                        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}?pulse=${p.id}`); alert("Linku u kopjua!"); }} className="p-1 text-gray-400 hover:text-white">
                          <Share2 size={14}/>
                        </button>

                        {myPulses.includes(p.id) && (
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteMyPulse(p.id, p.audio_url); }} className="p-1 text-red-500 hover:text-red-400 ml-auto">
                            <Trash2 size={14}/>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className={`w-10 h-10 rounded-full flex items-center justify-center z-10 shadow-lg ${isPlaying ? 'bg-peaky-blood text-white shadow-[0_0_15px_rgba(220,38,38,0.5)]' : 'bg-gray-800 text-gray-400'}`}>
                      {isPlaying ? <span className="animate-pulse font-mono text-xs">•••</span> : <Play size={16} className="ml-1" />}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 w-11/12 max-w-md">
        <div className="flex-1 relative">
          
          <AnimatePresence>
            {replyTo && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="absolute -top-14 left-0 right-0 flex justify-center">
                <div className="bg-peaky-blood text-white text-xs px-4 py-2 rounded-full flex items-center gap-2 shadow-[0_0_15px_rgba(220,38,38,0.6)]">
                  <MessageCircle size={12} className="animate-pulse" /> Po i kthen përgjigje {replyTo.category}
                  <button onClick={(e) => { e.stopPropagation(); setReplyTo(null); stopRecording(); }} className="ml-2 bg-black/30 rounded-full p-0.5 hover:bg-black/50">
                    <X size={12} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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
              className={`w-full py-4 rounded-full font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all ${isRecording ? 'bg-white text-black animate-pulse' : 'bg-peaky-blood text-white shadow-[0_0_20px_rgba(220,38,38,0.5)] hover:bg-red-700 hover:scale-[1.02]'}`}>
              {isRecording ? <Square size={16} fill="black"/> : <Radio size={18} />}
              {isRecording ? 'Stop & Zgjidh' : 'Lësho Zërin Këtu'}
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