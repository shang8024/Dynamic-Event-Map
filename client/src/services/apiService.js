import {apiBase} from './endpoints';
import {getVerifiedIdToken} from './authToken';
import {clientError,requestJSON} from './apiErrors';

export const API_BASE_URL=import.meta.env.VITE_API_BASE_URL??'/api';
export const API_BASE=apiBase(API_BASE_URL);
async function request(url,{method='GET',data,signal}={}) {
  const headers={};let token;
  try {token=await getVerifiedIdToken();} catch(error) {throw clientError(error);}
  if(token) headers.Authorization=`Bearer ${token}`;
  if(data!==undefined) headers['Content-Type']='application/json';
  return requestJSON(`${API_BASE}${url}`,{method,headers,signal,...(data===undefined?{}:{body:JSON.stringify(data)})});
}
export const get=(url,options={})=>request(url,options);
export const post=(url,data)=>request(url,{method:'POST',data});
export const put=(url,data)=>request(url,{method:'PUT',data});
export const del=url=>request(url,{method:'DELETE'});
