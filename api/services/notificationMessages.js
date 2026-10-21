const {signUnsubscribe}=require('./notificationPolicy');

function configuration(env=process.env) {
  const url=new URL(env.PUBLIC_APP_URL || 'http://localhost:3000');
  if (env.NODE_ENV==='production' && url.protocol!=='https:') throw new Error('PUBLIC_APP_URL must use HTTPS');
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid PUBLIC_APP_URL');
  return {origin:url.origin,sender:env.EMAIL_SENDER_NAME || 'Dynamic Event Map',contact:env.EMAIL_SENDER_CONTACT || ''};
}
function formatDate(value) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',dateStyle:'full',timeStyle:'short'}).format(new Date(value));
}
function buildMessage(row,{key,config,events=[]}) {
  const scope=row.kind==='marketing'?'marketing':'reminders';
  const unsubscribeURL=`${config.origin}/unsubscribe?token=${signUnsubscribe(row.user_id,scope,key)}`;
  const footer=`\n\n${config.sender}\n${config.contact ? `${config.contact}\n` : ''}Email settings: ${config.origin}/settings\nUnsubscribe from ${scope}: ${unsubscribeURL}`;
  if (row.kind==='marketing') {
    if (!config.contact.trim()) throw new Error('Marketing requires configured sender contact details');
    if (!events.length) return null;
    return {to:row.delivery_email,subject:'Your weekly Toronto event picks',unsubscribeURL,text:
      `This week on Dynamic Event Map\n\n${events.slice(0,6).map(e=>`${e.title}\n${formatDate(e.starts_at)} (America/Toronto)\n${e.location_address || ''}\n${e.reason}`).join('\n\n')}\n\nExplore events: ${config.origin}/recommendations\nYou receive this email because you opted in to weekly discovery emails.${footer}`};
  }
  return {to:row.delivery_email,subject:`Reminder: ${row.title}`,unsubscribeURL,text:
    `${row.title}\nStarts: ${formatDate(row.occurrence_start)} (America/Toronto)\n${row.location_name || ''}\n${row.location_address || ''}\n\nView your saved events: ${config.origin}/bookmarks\nCheck the organizer's current schedule before travelling.\nYou receive this reminder because you saved this event and enabled reminders.${footer}`};
}
module.exports={configuration,formatDate,buildMessage};
