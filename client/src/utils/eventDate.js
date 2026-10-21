import {Temporal} from '@js-temporal/polyfill';
export function torontoInput(value) {
  if(!value) return '';
  return Temporal.Instant.from(new Date(value).toISOString()).toZonedDateTimeISO('America/Toronto').toPlainDateTime().toString({smallestUnit:'minute'});
}
export function torontoInstant(value,original) {
  if(!value) return null;
  if(original && torontoInput(original)===value) return new Date(original).toISOString();
  const plain=Temporal.PlainDateTime.from(value);
  return plain.toZonedDateTime('America/Toronto',{disambiguation:'reject'}).toInstant().toString();
}
