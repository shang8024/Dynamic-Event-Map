const images=require('./eventImages');
async function preparePhoto(value) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw Object.assign(new Error('Check your photo details.'),{status:400});
  const image={url:images.validateImageURL(value.url).href,source:'link',
    alt:typeof value.alt==='string'?value.alt.slice(0,500):'',credit:typeof value.credit==='string'?value.credit.slice(0,300):''};
  const bytes=await images.getImage(image.url,'thumb');
  return {image,bytes};
}
module.exports={preparePhoto};
