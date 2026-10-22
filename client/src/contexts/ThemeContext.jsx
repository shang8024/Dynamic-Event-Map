import {createContext,useContext,useEffect,useLayoutEffect,useState} from 'react';

const ThemeContext=createContext(null);
const STORAGE_KEY='eventmap-color-mode';
const validPreference=value=>value==='light'||value==='dark'?value:null;
function storedPreference() {
  try {return validPreference(localStorage.getItem(STORAGE_KEY));} catch {return null;}
}

export function ThemeProvider({children}) {
  const [preference,setPreference]=useState(storedPreference);
  const [systemDark,setSystemDark]=useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches);
  const colorMode=preference||(systemDark?'dark':'light');
  useLayoutEffect(()=>{
    document.documentElement.dataset.theme=colorMode==='dark'?'sunset':'caramellatte';
  },[colorMode]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    const changed=()=>setSystemDark(media.matches);
    const saved=event=>{if(event.key===STORAGE_KEY||event.key===null) setPreference(storedPreference());};
    changed();media.addEventListener('change',changed);window.addEventListener('storage',saved);
    return()=>{media.removeEventListener('change',changed);window.removeEventListener('storage',saved);};
  },[]);
  function toggleColorMode() {
    const next=colorMode==='dark'?'light':'dark';
    setPreference(next);
    try {localStorage.setItem(STORAGE_KEY,next);} catch { /* Still works for this visit when storage is unavailable. */ }
  }
  return <ThemeContext.Provider value={{colorMode,toggleColorMode}}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const value=useContext(ThemeContext);
  if(!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
