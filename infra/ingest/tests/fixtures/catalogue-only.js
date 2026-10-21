// Explicit test preloader: any attempt to download the large feed fails.
import { METADATA_URL } from '../../normalize.js';
const metadata=JSON.parse(process.env.MOCK_OFFICIAL_METADATA);
globalThis.fetch=async url=>{
  if(String(url)!==METADATA_URL) throw new Error('Large source download attempted during metadata-only test');
  return new Response(JSON.stringify({success:true,result:{resources:[{
    id:metadata.resource_id,url:metadata.source_url,last_modified:metadata.source_last_modified,
    size:metadata.source_size,hash:metadata.source_hash,format:'JSON',
  }]}}),{headers:{'Content-Type':'application/json'}});
};
