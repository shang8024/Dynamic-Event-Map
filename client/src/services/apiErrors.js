const messages={
  account_disabled:'This account is unavailable. Please contact support.',
  session_revoked:'Your session was ended. Sign out and sign in again to continue.',
  email_not_verified:'Verify your email, then check your verification again.',
  sign_in_required:'Sign in with a verified email to continue.',
  account_link_required:'This email is connected to another account. Use your original sign-in method or contact support.',
  IMAGE_URL_INVALID:'Use a direct HTTPS image link without a username, password or fragment.',
  IMAGE_HOST_NOT_ALLOWED:'This image host is not supported. Use secure.toronto.ca, images.unsplash.com, i.imgur.com, res.cloudinary.com or images.pexels.com.',
  IMAGE_ADDRESS_BLOCKED:'This image link was blocked by our security checks. Choose another public image link.',
  IMAGE_UNREACHABLE:'The image could not be reached. Check that the direct image link is public and try again.',
  IMAGE_FORMAT_UNSUPPORTED:'Use a still JPEG, PNG, WebP or AVIF image. Web pages, SVGs and animated images are not accepted.',
  IMAGE_TOO_LARGE:'This image is too large. Use an image smaller than 8 MB and no more than 12 million pixels.',
  IMAGE_INVALID:'This file could not be read as a supported image. Choose another direct image link.',
  IMAGE_REDIRECT_REJECTED:'This image link redirects too many times. Use the final direct image link.',
  IMAGE_TIMEOUT:'Checking this image took too long. Try again or choose another image link.',
  IMAGE_BUSY:'Too many images are being checked. Please wait a moment and try again.',
  IMAGE_SERVICE_UNAVAILABLE:'Image checking is temporarily unavailable. Your photo has not been changed. Please try again later.',
};
// Product validation messages only: dependency/SQL/decoder responses are private.
const validationMessages=new Set([
  'title is required','description is required','location address is required','An event field is too long',
  'A valid location is required','Dates must include a timezone','Valid start and end times are required',
  'End time must be after start time','Invalid event status','Invalid place',
  'The event location must be within the GTA.',
  'Add between 1 and 366 event occurrences.','Invalid event occurrence.','Invalid or duplicate occurrence identity.',
  'Occurrence dates must include a valid timezone.','An occurrence must end after it starts.','Remove duplicate event occurrences.',
  'This event changed. Reopen it before saving.','This event is archived and cannot be edited.',
  'Missing comment text','Invalid JSON request body','Request body is too large',
  'Choose whether you are an organizer or are sharing an event.','Organizer confirmation must be a checkbox value.',
  'Confirm that you are the organizer or are authorized to publish on their behalf.','Organizer name must be 255 characters or fewer.',
  'Explain your changes in 1 to 2000 characters.','Check your proposed event changes.','Change at least one event detail before submitting.',
  'This event changed. Reopen it before submitting a suggestion.','You already have 10 suggestions waiting for review.',
  'You already have a suggestion waiting for review for this event.','This submission has already been reviewed.',
  'This event changed since submission. Reject this suggestion and ask for a new one.',
  'This event is no longer available for community changes.','Include a review reason in 1 to 2000 characters.',
  'This event has ended or been archived and cannot accept suggestions.','Another administrator must review your own suggestion.',
]);
export class ApiError extends Error {
  constructor(message,{status=null,code='request_failed',retryAfter=null,ambiguous=false}={}) {
    super(message);this.name='ApiError';this.status=status;this.code=code;this.retryAfter=retryAfter;this.ambiguous=ambiguous;
  }
}
export function retryAfterSeconds(value,now=Date.now()) {
  if(typeof value!=='string'||!value.trim()) return null;
  if(/^\d+$/.test(value.trim())) return Math.min(Number(value),86400);
  if(!/[a-z]/i.test(value)) return null;
  const at=Date.parse(value);return Number.isFinite(at)?Math.min(86400,Math.max(0,Math.ceil((at-now)/1000))):null;
}
const mutation=method=>!['GET','HEAD','OPTIONS'].includes(String(method||'GET').toUpperCase());
export async function responseError(response,{method='GET',unsubscribe=false}={}) {
  const status=response.status,body=await response.json().catch(()=>null);
  const raw=typeof body?.error==='string'?body.error:typeof body?.message==='string'?body.message:'';
  let code=typeof body?.code==='string'&&Object.hasOwn(messages,body.code)?body.code:null;
  if(status===403&&raw==='A verified email address is required') code='email_not_verified';
  if(status===409&&raw==='Account linking is required') code='account_link_required';
  const retryAfter=retryAfterSeconds(response.headers?.get?.('Retry-After'));
  let message=code?messages[code]:null;
  if(unsubscribe&&status===400) {code='unsubscribe_invalid';message='This unsubscribe link is invalid or expired. Sign in to change your email preferences instead.';}
  if(!message&&status>=400&&status<500&&validationMessages.has(raw)) {message=raw;code=status===409?'conflict':status===410?'archived':'validation_error';}
  if(!message) {
    if(status===401) {code='sign_in_required';message='Please sign in again to continue.';}
    else if(status===403) {code='forbidden';message='You do not have permission to make this change.';}
    else if(status===404) {code='not_found';message='This item is no longer available. Refresh the page to check its current status.';}
    else if(status===409) {code='conflict';message='This item changed. Refresh its details before trying again.';}
    else if(status===410) {code='archived';message='This item has ended or been archived and cannot be changed.';}
    else if(status===429) {code='rate_limited';message=retryAfter?`Too many requests. Wait ${retryAfter} seconds before trying again.`:'Too many requests. Please wait a few minutes before trying again.';}
    else if(status>=500) {code='service_unavailable';message='This service is temporarily unavailable. Please try again.';}
    else {code='invalid_request';message='Check your entries and try again.';}
  }
  return new ApiError(message,{status,code:code||'validation_error',retryAfter,ambiguous:mutation(method)&&status>=500});
}
export function clientError(error,{method='GET',dispatched=false}={}) {
  if(error instanceof ApiError) return error;
  const authCodes={'auth/user-disabled':'account_disabled','auth/user-token-expired':'sign_in_required',
    'auth/invalid-user-token':'sign_in_required','auth/requires-recent-login':'sign_in_required'};
  if(authCodes[error?.code]) return new ApiError(messages[authCodes[error.code]],{status:401,code:authCodes[error.code]});
  const timedOut=error?.name==='TimeoutError',cancelled=error?.name==='AbortError';
  return new ApiError(timedOut?'The request took too long. Check its current status before trying again.'
    :cancelled?'The request was interrupted. Check its current status before trying again.'
      :'Check your connection and try again.',{code:timedOut?'network_timeout':cancelled?'request_cancelled':'network_error',ambiguous:dispatched&&mutation(method)});
}
export async function requestJSON(url,options={},fetchImpl=fetch) {
  const {unsubscribe,...requestOptions}=options,method=options.method||'GET';let response;
  try {response=await fetchImpl(url,{...requestOptions,signal:options.signal||AbortSignal.timeout(20000)});}
  catch(error) {throw clientError(error,{method,dispatched:true});}
  if(!response.ok) throw await responseError(response,{method,unsubscribe});
  try {return await response.json();}
  catch {throw new ApiError('The response could not be confirmed. Refresh the current status before trying again.',
    {status:response.status,code:'response_unconfirmed',ambiguous:mutation(method)});}
}
