// Only these public messages cross the worker/API boundary. Never expose DNS,
// upstream response bodies, decoder details or user-provided URLs in errors.
const MESSAGES={
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
class ImageError extends Error {
  constructor(code) {super(MESSAGES[code]||MESSAGES.IMAGE_INVALID);this.code=Object.hasOwn(MESSAGES,code)?code:'IMAGE_INVALID';}
}
function publicImageError(error) {
  if(error instanceof ImageError) return {code:error.code,error:error.message};
  if(error?.name==='AbortError' || error?.name==='TimeoutError') return publicImageError(new ImageError('IMAGE_TIMEOUT'));
  return publicImageError(new ImageError('IMAGE_SERVICE_UNAVAILABLE'));
}
function imageStatus(error){return ['IMAGE_BUSY','IMAGE_SERVICE_UNAVAILABLE'].includes(error?.code)?503:error?.code==='IMAGE_TIMEOUT'?504:422;}
module.exports={ImageError,publicImageError,imageStatus};
