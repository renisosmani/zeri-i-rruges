'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Map, { Marker, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import useSupercluster from 'use-supercluster';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Play, Square, X, Flame, Radio, List, Trash2, MapPin, Clock, Users, MessageCircle, AlertTriangle, Car, PlayCircle, CheckCircle2, XCircle } from 'lucide-react'; 
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

type Pulse = { id: string; lat: number; lng: number; energy_value: number; audio_url: string; created_at: string; category: string; respect_count: number; parent_id?: string | null; is_quick_report?: boolean; deny_count?: number; };

function MapEngine() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activePulse, setActivePulse] = useState<Pulse | null>(null);
  const [activeReport, setActiveReport] = useState<Pulse | null>(null);
  const [reportAddress, setReportAddress] = useState<string>("Duke kërkuar adresën...");
  const [activeCluster, setActiveCluster] = useState<Pulse[] | null>(null);
  const [replyTo, setReplyTo] = useState<Pulse | null>(null);
  const [trendingMsg, setTrendingMsg] = useState<string | null>(null);
  const lastTrendingState = useRef<string>('');
  const [catPos, setCatPos] = useState({ lat: 41.3275, lng: 19.8187 });
  const [showCatModal, setShowCatModal] = useState(false);
  const [hasSeenCat, setHasSeenCat] = useState(false);
  const [showGlobalList, setShowGlobalList] = useState(false);
  const [bounds, setBounds] = useState<[number, number, number, number] | undefined>(undefined);
  const [zoom, setZoom] = useState(7);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [deniedReports, setDeniedReports] = useState<string[]>([]);
  const [uploadStep, setUploadStep] = useState<'idle' | 'recording' | 'category' | 'uploading'>('idle');
  const [myPulses, setMyPulses] = useState<string[]>([]); 
  const [respectedPulses, setRespectedPulses] = useState<string[]>([]);

  const mapRef = useRef<MapRef>(null);
  const { isRecording, liveEnergy, peakEnergy, audioBlob, startRecording, stopRecording } = useAudioPulse();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentAudioElement = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef<Pulse[]>([]);
  const currentPlayIndexRef = useRef<number>(-1);
  const isAutoPlayRef = useRef<boolean>(false);
  const [isAutoPlayingState, setIsAutoPlayingState] = useState(false);

  useEffect(() => {
    if (hasSeenCat) return; 
    const catWander = setInterval(() => {
      setCatPos(prev => {
        let newLat = prev.lat + (Math.random() - 0.5) * 0.08;
        let newLng = prev.lng + (Math.random() - 0.5) * 0.08;
        if (newLat < 39.5) newLat = 39.5; if (newLat > 43.0) newLat = 43.0;
        if (newLng < 18.5) newLng = 18.5; if (newLng > 21.5) newLng = 21.5;
        return { lat: newLat, lng: newLng };
      });
    }, 3000);
    return () => clearInterval(catWander);
  }, [hasSeenCat]);

  useEffect(() => { if (audioBlob) setUploadStep('category'); }, [audioBlob]);

  useEffect(() => {
    if (activeReport) {
      setReportAddress("Duke kërkuar adresën...");
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${activeReport.lat}&lon=${activeReport.lng}&accept-language=sq`)
        .then(res => res.json())
        .then(data => { setReportAddress(data.address?.road || data.display_name?.split(',')[0] || 'Rrugë e panjohur'); })
        .catch(() => setReportAddress("Lokacion i paditur"));
    }
  }, [activeReport]);

  useEffect(() => {
    setMyPulses(JSON.parse(localStorage.getItem('myPulses') || '[]'));
    setRespectedPulses(JSON.parse(localStorage.getItem('respectedPulses') || '[]'));
    setDeniedReports(JSON.parse(localStorage.getItem('deniedReports') || '[]'));
    
    const fetchPulses = async () => {
      const yesterday = new Date(Date.now() - MAX_AGE_MS).toISOString();
      const { data } = await supabase.from('pulses').select('*').gte('created_at', yesterday).order('created_at', { ascending: false });
      if (data) {
        const now = Date.now();
        const validPulses = data.filter(p => {
          const age = now - new Date(p.created_at).getTime();
          if (p.category === '👻') return age <= 2 * 60 * 60 * 1000;
          if (p.is_quick_report) return age <= 45 * 60 * 1000; 
          return true;
        });
        setPulses(validPulses);
      }
    };
    fetchPulses();

    const channel = supabase.channel('realtime_pulses').on('postgres_changes', { event: '*', schema: 'public', table: 'pulses' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setPulses(prev => prev.some(p => p.id === payload.new.id) ? prev : [payload.new as Pulse, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setPulses(prev => prev.map(p => p.id === payload.new.id ? payload.new as Pulse : p));
          if (activeReport?.id === payload.new.id) setActiveReport(payload.new as Pulse);
        } else if (payload.eventType === 'DELETE') {
          setPulses(prev => prev.filter(p => p.id !== payload.old.id));
          if (activeReport?.id === payload.old.id) setActiveReport(null);
        }
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeReport]);

  const handlePlayPulse = async (pulse: Pulse, fromAutoPlay = false) => {
    if (pulse.is_quick_report) return;
    if (currentAudioElement.current) { currentAudioElement.current.pause(); currentAudioElement.current.src = ""; }
    if (!fromAutoPlay) { isAutoPlayRef.current = false; setIsAutoPlayingState(false); }
    setActivePulse(pulse); setAudioDuration(null);
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
      const audio = new Audio(pulse.audio_url);
      audio.crossOrigin = "anonymous";
      audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration));
      currentAudioElement.current = audio;
      audio.play();
      audio.onended = () => { if (isAutoPlayRef.current) playNextInQueue(); else setActivePulse(null); };
    } catch (err) { console.error(err); }
  };

  const startAutoPlay = () => {
    if (parentsForList.length === 0) return;
    playlistRef.current = parentsForList;
    currentPlayIndexRef.current = 0;
    isAutoPlayRef.current = true;
    setIsAutoPlayingState(true);
    handlePlayPulse(parentsForList[0], true);
  };

  const playNextInQueue = () => {
    currentPlayIndexRef.current += 1;
    const nextPulse = playlistRef.current[currentPlayIndexRef.current];
    if (nextPulse) handlePlayPulse(nextPulse, true);
    else { isAutoPlayRef.current = false; setIsAutoPlayingState(false); setActivePulse(null); }
  };

  const handleQuickReport = async (type: '👮' | '🚗') => {
    let lat = 41.3275; let lng = 19.8187;
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => { navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 5000 }); });
      lat = pos.coords.latitude; lng = pos.coords.longitude;
    } catch (e) { alert("Ndez GPS!"); return; }
    const { data } = await supabase.from('pulses').insert([{ lat, lng, energy_value: 1, category: type, respect_count: 1, deny_count: 0, is_quick_report: true, audio_url: '' }]).select();
    if (data) {
      setPulses(prev => [data[0], ...prev]);
      const newMy = [...myPulses, data[0].id];
      setMyPulses(newMy); localStorage.setItem('myPulses', JSON.stringify(newMy));
    }
  };

  const handleDenyReport = async (pulse: Pulse) => {
    if (deniedReports.includes(pulse.id)) { alert("Votuar tashmë!"); return; }
    const newDeny = (pulse.deny_count || 0) + 1;
    const newDeniedList = [...deniedReports, pulse.id];
    setDeniedReports(newDeniedList);
    localStorage.setItem('deniedReports', JSON.stringify(newDeniedList));
    if (newDeny >= 5) { await supabase.from('pulses').delete().eq('id', pulse.id); setActiveReport(null); }
    else { await supabase.from('pulses').update({ deny_count: newDeny }).eq('id', pulse.id); }
  };

  const handleGiveRespect = async (id: string) => {
    if (respectedPulses.includes(id)) { alert("Votuar tashmë!"); return; }
    const newRes = [...respectedPulses, id];
    setRespectedPulses(newRes);
    localStorage.setItem('respectedPulses', JSON.stringify(newRes));
    await supabase.rpc('increment_respect', { row_id: id });
  };

  const handleUploadWithCategory = async (cat: string) => {
    if (!audioBlob) return;
    setUploadStep('uploading');
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => { navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }); });
      const lat = pos.coords.latitude; const lng = pos.coords.longitude;
      const fileName = `${Date.now()}.webm`;
      await supabase.storage.from('audio_pulses').upload(fileName, audioBlob);
      const { data: url } = supabase.storage.from('audio_pulses').getPublicUrl(fileName);
      const { data } = await supabase.from('pulses').insert([{ lat, lng, energy_value: peakEnergy || 0.5, audio_url: url.publicUrl, category: cat, respect_count: 0, parent_id: replyTo ? replyTo.id : null }]).select();
      if (data) {
        setPulses(prev => [data[0], ...prev]);
        const newMy = [...myPulses, data[0].id];
        setMyPulses(newMy); localStorage.setItem('myPulses', JSON.stringify(newMy));
      }
    } catch (e) { alert("GPS Problem!"); }
    finally { setUploadStep('idle'); setReplyTo(null); }
  };

  const handleDeleteMyPulse = async (pulseId: string, audioUrl: string) => {
    if (!confirm("Fshi?")) return;
    await supabase.from('pulses').delete().eq('id', pulseId);
    if (audioUrl) {
      const fileName = audioUrl.split('/').pop();
      if (fileName) await supabase.storage.from('audio_pulses').remove([fileName]);
    }
    setPulses(prev => prev.filter(p => p.id !== pulseId));
    setActivePulse(null); setActiveReport(null);
  };

  const updateMapBounds = () => {
    if (mapRef.current) {
      const b = mapRef.current.getMap().getBounds();
      setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      setZoom(mapRef.current.getMap().getZoom());
    }
  };

  const parentsForList = pulses.filter(p => {
    const isParent = !p.parent_id && !p.is_quick_report;
    const age = Date.now() - new Date(p.created_at).getTime();
    if (p.category === '👻') return isParent && age <= 2 * 60 * 60 * 1000;
    return isParent;
  }).sort((a, b) => b.respect_count - a.respect_count);

  const points = pulses.map(pulse => ({ type: 'Feature' as const, properties: { cluster: false, ...pulse }, geometry: { type: 'Point' as const, coordinates: [pulse.lng, pulse.lat] as [number, number] } }));
  const { clusters, supercluster } = useSupercluster({ points, bounds, zoom, options: { radius: 60, maxZoom: 15 } });

  return (
    <main className="relative w-full h-[100dvh] bg-peaky-black overflow-hidden font-sans select-none">
      
      <AnimatePresence>{trendingMsg && <motion.div initial={{ y: -50 }} animate={{ y: 0 }} exit={{ y: -50 }} className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-peaky-blood/90 px-5 py-2 rounded-full border border-red-500 text-white text-xs font-bold shadow-neon-red uppercase tracking-widest flex items-center gap-2"><Radio size={14} className="animate-pulse"/> {trendingMsg}</motion.div>}</AnimatePresence>

      <Map ref={mapRef} initialViewState={{ longitude: 20.1683, latitude: 41.1533, zoom: 7, pitch: 45 }} maxBounds={ALBANIA_BOUNDS} mapStyle={MAP_STYLE} attributionControl={false} onMove={updateMapBounds} onLoad={updateMapBounds}>
        {clusters.map(cluster => {
          const [longitude, latitude] = cluster.geometry.coordinates;
          const { cluster: isCluster, point_count: ptCount } = cluster.properties as any;
          if (isCluster) return <Marker key={cluster.id} longitude={longitude} latitude={latitude}><div onClick={() => setActiveCluster(supercluster?.getLeaves(cluster.id as number, Infinity).map(l => l.properties as Pulse) || null)} className="w-10 h-10 bg-peaky-charcoal border-2 border-peaky-blood rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg cursor-pointer">{ptCount}</div></Marker>;
          const pulse = cluster.properties as Pulse;
          if (pulse.is_quick_report) return <Marker key={pulse.id} longitude={longitude} latitude={latitude} anchor="bottom"><motion.div whileHover={{ scale: 1.1 }} onClick={() => setActiveReport(pulse)} className={`cursor-pointer text-2xl p-2 rounded-full bg-black/40 border border-white/20 backdrop-blur-sm shadow-xl ${pulse.category === '👮' ? 'animate-pulse' : ''}`}>{pulse.category}</motion.div></Marker>;
          const mood = getMoodStyle(pulse.energy_value);
          return <Marker key={pulse.id} longitude={longitude} latitude={latitude} anchor="bottom"><div className="flex flex-col items-center cursor-pointer" onClick={() => handlePlayPulse(pulse)}><span className="text-2xl mb-1">{pulse.category}</span><div className="w-4 h-4 rounded-full border-2 border-white" style={{ backgroundColor: mood.color, boxShadow: `0 0 15px ${mood.color}` }} /></div></Marker>;
        })}
        {!hasSeenCat && <Marker longitude={catPos.lng} latitude={catPos.lat} anchor="bottom"><div onClick={(e) => { e.stopPropagation(); setShowCatModal(true); setHasSeenCat(true); }} className="cursor-pointer text-xl drop-shadow-neon hover:scale-125 transition-transform">🐈‍⬛</div></Marker>}
      </Map>

      <AnimatePresence>{activeReport && (
        <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50 }} className="absolute bottom-32 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-sm bg-peaky-charcoal/95 backdrop-blur-xl border border-peaky-steel p-5 rounded-3xl text-center shadow-2xl">
          <button onClick={() => setActiveReport(null)} className="absolute top-4 right-4 text-gray-500"><X/></button>
          <div className="text-5xl mb-2">{activeReport.category}</div>
          <h2 className="text-white font-bold text-lg mb-4">{activeReport.category === '👮' ? 'Polici' : 'Trafik'} në {reportAddress}</h2>
          <div className="flex gap-3">
            <button onClick={() => handleGiveRespect(activeReport.id)} className={`flex-1 py-3 rounded-2xl border flex flex-col items-center ${respectedPulses.includes(activeReport.id) ? 'bg-green-500/10 border-green-500/30 text-green-500 cursor-not-allowed' : 'bg-black border-peaky-steel text-gray-300'}`}><CheckCircle2 size={24}/><span className="text-xs font-bold mt-1">Konfirmo (x{activeReport.respect_count})</span></button>
            <button onClick={() => handleDenyReport(activeReport)} className={`flex-1 py-3 rounded-2xl border flex flex-col items-center ${deniedReports.includes(activeReport.id) ? 'bg-red-500/10 border-red-500/30 text-red-500 cursor-not-allowed' : 'bg-black border-peaky-steel text-gray-300'}`}><XCircle size={24}/><span className="text-xs font-bold mt-1">S'ka Gjë ({activeReport.deny_count || 0}/5)</span></button>
          </div>
          {myPulses.includes(activeReport.id) && <button onClick={() => handleDeleteMyPulse(activeReport.id, '')} className="mt-4 text-red-500 text-xs flex items-center justify-center gap-1"><Trash2 size={12}/> Fshi Raportimin Tim</button>}
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{showGlobalList && (
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="absolute inset-0 z-[60] bg-peaky-black/98 backdrop-blur-3xl flex flex-col">
          <div className="pt-12 pb-4 px-6 flex justify-between items-center border-b border-peaky-steel/30"><div><h1 className="text-white text-xl font-bold">Top Zërat</h1><p className="text-gray-500 text-[10px] font-mono uppercase tracking-widest">{parentsForList.length} LIVE</p></div><button onClick={() => setShowGlobalList(false)} className="p-2 bg-gray-800 rounded-full text-gray-400"><X/></button></div>
          <div className="p-4"><button onClick={isAutoPlayingState ? () => { isAutoPlayRef.current = false; setIsAutoPlayingState(false); currentAudioElement.current?.pause(); setActivePulse(null); } : startAutoPlay} className={`w-full py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${isAutoPlayingState ? 'bg-peaky-blood text-white animate-pulse shadow-neon-red' : 'bg-peaky-gold/10 text-peaky-gold border border-peaky-gold/30'}`}>{isAutoPlayingState ? <Square fill="white" size={16}/> : <PlayCircle fill="currentColor" size={20}/>} {isAutoPlayingState ? 'Ndalo Radion' : 'Radio Mode'}</button></div>
          <div className="flex-1 overflow-y-auto px-4 pb-20 space-y-3">{parentsForList.map((p, idx) => (
            <div key={p.id} onClick={() => handlePlayPulse(p)} className={`p-4 rounded-2xl flex items-center gap-4 border transition-all ${activePulse?.id === p.id ? 'bg-peaky-blood/10 border-peaky-blood shadow-neon-red' : 'bg-peaky-charcoal/30 border-peaky-steel/30'}`}><span className="text-3xl relative">{p.category}{idx === 0 && <span className="absolute -top-2 -right-2 text-xs">👑</span>}</span><div className="flex-1"><div className="flex justify-between items-center text-white font-bold text-sm"><span>{getNearestCity(p.lat, p.lng)}</span><span className="text-[10px] text-gray-500 font-mono">{getTimeAgo(p.created_at)}</span></div><div className="flex gap-3 mt-1 items-center"><span className="text-peaky-gold text-[10px] flex items-center gap-1 font-bold"><Flame size={10}/> {p.respect_count}</span>{myPulses.includes(p.id) && <button onClick={(e) => { e.stopPropagation(); handleDeleteMyPulse(p.id, p.audio_url); }} className="text-red-500"><Trash2 size={12}/></button>}</div></div><div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-gray-400">{activePulse?.id === p.id ? <div className="w-2 h-2 bg-peaky-blood animate-ping rounded-full"/> : <Play size={12}/>}</div></div>
          ))}</div>
        </motion.div>
      )}</AnimatePresence>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 w-11/12 max-w-lg flex items-end justify-between gap-3">
        <button onClick={() => setShowGlobalList(true)} className="w-14 h-14 bg-peaky-charcoal border-2 border-peaky-steel rounded-2xl flex flex-col items-center justify-center text-gray-400 shadow-2xl transition-all hover:border-peaky-gold"><List size={22} /><span className="text-[8px] font-bold mt-1">RADIO</span></button>
        <div className="flex-1 relative">
          <AnimatePresence>{replyTo && <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute -top-12 left-0 right-0 flex justify-center"><div className="bg-peaky-blood text-white text-[10px] font-bold px-3 py-1.5 rounded-full flex items-center gap-2 shadow-neon-red">Reply to {replyTo.category} <X size={10} onClick={() => setReplyTo(null)}/></div></motion.div>}</AnimatePresence>
          {isRecording && <div className="absolute -top-4 left-0 right-0 flex justify-center"><motion.div className="h-1 bg-peaky-gold rounded-full shadow-neon-gold" animate={{ width: `${liveEnergy * 100}%` }} /></div>}
          {uploadStep === 'category' ? (
            <div className="flex justify-around bg-peaky-charcoal p-2 rounded-2xl border-2 border-peaky-steel shadow-2xl h-14 items-center">{['💬', '🎸', '🚨'].map(c => <button key={c} onClick={() => handleUploadWithCategory(c)} className="text-2xl hover:scale-125 transition-transform px-3">{c}</button>)}</div>
          ) : (
            <button onClick={isRecording ? stopRecording : startRecording} className={`w-full h-14 rounded-2xl font-bold uppercase tracking-tighter text-sm flex items-center justify-center gap-2 transition-all ${isRecording ? 'bg-white text-black' : 'bg-peaky-blood text-white shadow-neon-red border-2 border-red-500 hover:bg-red-700'}`}>{isRecording ? <Square size={16} fill="black"/> : <Radio size={18} />} {isRecording ? 'STOP' : 'Lësho Zërin'}</button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => handleQuickReport('👮')} className="w-12 h-12 bg-blue-600 border-2 border-white rounded-full flex items-center justify-center text-white shadow-lg"><AlertTriangle size={18} /></motion.button>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => handleQuickReport('🚗')} className="w-12 h-12 bg-orange-500 border-2 border-white rounded-full flex items-center justify-center text-white shadow-lg"><Car size={18} /></motion.button>
        </div>
      </div>

      <AnimatePresence>{activePulse && !showGlobalList && !activeReport && (
        <motion.div initial={{ y: 50 }} animate={{ y: 0 }} exit={{ y: 50 }} className="absolute bottom-32 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-sm bg-peaky-charcoal/95 backdrop-blur-xl border border-peaky-steel p-4 rounded-3xl flex items-center gap-4 shadow-2xl">
          <div className="text-4xl">{activePulse.category}</div>
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1"><span className="text-[10px] text-gray-500 font-mono"><Clock size={10} className="inline mr-1"/>{getTimeAgo(activePulse.created_at)}</span>{audioDuration && <span className="text-xs text-peaky-gold font-bold">{Math.round(audioDuration)}s</span>}</div>
            <div className="flex items-center gap-3">
              <button onClick={() => handleGiveRespect(activePulse.id)} className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded ${respectedPulses.includes(activePulse.id) ? 'text-orange-400 bg-orange-500/10' : 'text-gray-400'}`}><Flame size={12}/> {activePulse.respect_count}</button>
              <button onClick={() => { setReplyTo(activePulse); startRecording(); }} className="text-blue-400"><MessageCircle size={14}/></button>
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?p=${activePulse.id}`); alert("Copied!"); }} className="text-gray-400"><Share2 size={14}/></button>
              {myPulses.includes(activePulse.id) && <button onClick={() => handleDeleteMyPulse(activePulse.id, activePulse.audio_url)} className="text-red-500"><Trash2 size={14}/></button>}
            </div>
          </div>
          <button onClick={() => { currentAudioElement.current?.pause(); setActivePulse(null); setIsAutoPlayingState(false); }} className="w-10 h-10 bg-peaky-blood text-white rounded-full flex items-center justify-center shadow-neon-red"><Square size={14} fill="white"/></button>
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{showCatModal && (
        <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }} className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
          <div className="bg-peaky-charcoal border-2 border-peaky-gold p-8 rounded-3xl text-center max-w-xs shadow-neon-gold">
            <img src="/mini.jpeg" className="w-24 h-24 rounded-full mx-auto mb-4 border-2 border-peaky-gold object-cover" />
            <h2 className="text-white font-bold text-xl mb-2">Krye-Inxhinieri Mini 👑</h2>
            <p className="text-gray-400 text-xs mb-6 italic">"Kam shijuar gjithë rrugëtimin e programimit duke fjetur mbi tastierë! 💤⌨️"</p>
            <button onClick={() => setShowCatModal(false)} className="w-full py-3 bg-peaky-gold text-black font-bold rounded-xl uppercase tracking-widest text-xs">Mbyll Easter Egg</button>
          </div>
        </motion.div>
      )}</AnimatePresence>

    </main>
  );
}

export default function App() { return <Suspense fallback={<div className="w-screen h-screen bg-peaky-black"/>}><MapEngine /></Suspense>; }