import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVenuePhoto} from '../src/services/venuePhoto.js';

function library(position) {
  const calls=[];
  class Place {
    static async searchByText(request) {calls.push(request);return {places:[{id:'venue-id'}]};}
    constructor({id}) {assert.equal(id,'venue-id');this.location={lat:()=>position.lat,lng:()=>position.lng};this.photos=[{authorAttributions:[{displayName:'Photographer',uri:'https://maps.google.com/example'}],getURI(){calls.push('photo');return 'https://photos.googleusercontent.com/example';}}];}
    async fetchFields(request) {calls.push(request);}
  }
  return {Place,calls};
}
const event={position:{lat:43.65,lng:-79.39},location_address:'317 Dundas St W, Toronto',location_name:'Art gallery',data:{}};
test('venue fallback requests only an ID, photo and location; it preserves photographer credit',async()=>{
  const places=library(event.position),photo=await loadVenuePhoto(event,places);
  assert.deepEqual(places.calls[0].fields,['id']);assert.equal(places.calls[0].maxResultCount,1);
  assert.deepEqual(places.calls[1].fields,['photos','location']);assert.equal(photo.authors[0].displayName,'Photographer');
  assert.equal(places.calls.at(-1),'photo');
});
test('an unrelated place never supplies a venue photo and known IDs skip searching',async()=>{
  const wrong=library({lat:43.7,lng:-79.39});assert.equal(await loadVenuePhoto(event,wrong),null);assert.ok(!wrong.calls.includes('photo'));
  const known=library(event.position);await loadVenuePhoto({...event,data:{place_id:'venue-id'}},known);
  assert.deepEqual(known.calls[0],{fields:['photos','location']});
  const missing=library(event.position);assert.equal(await loadVenuePhoto({data:{}},missing),null);assert.equal(missing.calls.length,0);
});
