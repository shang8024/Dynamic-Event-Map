import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateDraft,matchReasons} from '../src/utils/eventDuplicates.js';

const occurrences=[{key:'a',starts_at:'2027-06-01T22:00:00.000Z',ends_at:''},{key:'b',starts_at:'2027-06-02T22:00:00.000Z',ends_at:'2027-06-03T00:00:00.000Z'}];

test('the duplicate check waits for a title, a pin and at least one date range',()=>{
  const form={title:' Jazz in the Park ',latitude:'43.6534',longitude:'-79.3841'};
  assert.equal(duplicateDraft({...form,title:'Hi'},occurrences),null);
  assert.equal(duplicateDraft({...form,latitude:''},occurrences),null);
  assert.equal(duplicateDraft({...form,longitude:null},occurrences),null);
  assert.equal(duplicateDraft({...form,latitude:'north'},occurrences),null);
  assert.equal(duplicateDraft(form,[]),null);
});

test('the request carries trimmed text, numeric coordinates and only the schedule fields',()=>{
  assert.deepEqual(duplicateDraft({title:' Jazz in the Park ',latitude:'43.6534',longitude:-79.3841,description:'ignored'},occurrences),{
    title:'Jazz in the Park',latitude:43.6534,longitude:-79.3841,
    occurrences:[{starts_at:'2027-06-01T22:00:00.000Z',ends_at:null},{starts_at:'2027-06-02T22:00:00.000Z',ends_at:'2027-06-03T00:00:00.000Z'}]});
});

test('match reasons describe each signal in plain language',()=>{
  assert.deepEqual(matchReasons({signals:{title:1,time:1,place:1}}),['similar title','same time','same place']);
  assert.deepEqual(matchReasons({signals:{title:0.2,time:0.6,place:0.3}}),['within a day','nearby']);
  assert.deepEqual(matchReasons({signals:{title:0.6,time:0,place:0}}),['similar title']);
  assert.deepEqual(matchReasons({}),[]);
});
