const paths={
  close:'M6 6l12 12M18 6 6 18',
  plus:'M12 5v14M5 12h14',
  minus:'M5 12h14',
  external:'M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  bookmark:'M6 3h12v19l-6-4-6 4V3Z',
  filters:'M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6m-8 0v6',
  arrow:'M5 12h14m-6-6 6 6-6 6',
  photo:'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 17l5-5 4 4 3-3 6 6M9 8h.01',
};
export default function Icon({name,size=20,className=''}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`ui-icon ${className}`}><path d={paths[name]||paths.arrow}/></svg>;
}
