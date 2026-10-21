const proxyAddress=require('proxy-addr');

function createProxyTrust(value='') {
  const networks=value.split(',').map(item=>item.trim()).filter(Boolean);
  if(!networks.length) return false;
  if(networks.some(item=>!item.includes('/'))) throw new Error('TRUSTED_PROXY_CIDRS requires explicit CIDR networks');
  const trusted=proxyAddress.compile(networks);
  // Exactly one configured Traefik hop is trusted. Earlier XFF entries supplied
  // by a client never become authoritative, even if they look like private IPs.
  return (address,hop)=>hop===0 && trusted(address);
}
module.exports={createProxyTrust};
