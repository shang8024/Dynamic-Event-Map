import {useLocation} from 'react-router-dom';

export default function SearchIndexing() {
  const {pathname,search}=useLocation();
  // React hoists this metadata into <head>, including after SPA navigation.
  return <meta name="robots" content={pathname==='/'&&!search?'index, follow':'noindex, follow'}/>;
}
