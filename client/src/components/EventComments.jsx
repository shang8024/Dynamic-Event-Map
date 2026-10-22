import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {fetchComments,addComment,removeComment} from '../services/commentsService';
import socket,{subscribeEvent} from '../services/socket';
import {useAuth} from '../contexts/AuthContext';
import {useAuthFlow} from '../contexts/AuthFlowContext';
export default function EventComments({eventId,preview=false,returnTo=`/?event=${eventId}`}) {
  const {user}=useAuth();
  const [comments,setComments]=useState([]),[text,setText]=useState(''),[error,setError]=useState('');
  const [total,setTotal]=useState(0);
  const [lastUpdated,setLastUpdated]=useState(null);
  const [busy,setBusy]=useState(false),[connected,setConnected]=useState(socket.connected),[loading,setLoading]=useState(true);
  const refresh=useRef(()=>{}),activeEvent=useRef(eventId);
  const composer=useRef(null);
  const requestAuth=useAuthFlow();
  const signIn=()=>requestAuth('join this conversation',returnTo,{kind:'comment',eventId});
  useEffect(()=>{
    let active=true,generation=0,controller,revision=-1,failed=false;
    activeEvent.current=eventId;setComments([]);setTotal(0);setText('');setError('');setLoading(true);setBusy(false);setLastUpdated(null);setConnected(socket.connected);
    async function load() {
      const request=++generation;controller?.abort();controller=new AbortController();
      try {
        const snapshot=await fetchComments(eventId,controller.signal,preview);
        if(!active || request!==generation || Number(snapshot.revision)<revision) return;
        revision=Number(snapshot.revision);failed=false;setComments(snapshot.comments);setTotal(snapshot.total??snapshot.comments.length);setError('');setLastUpdated(new Date());
      } catch(failure) {if(active && request===generation && failure.name!=='AbortError') {failed=true;setError('Unable to refresh comments. Retrying automatically.');}}
      finally {if(active && request===generation) setLoading(false);}
    }
    refresh.current=load;
    const unsubscribe=subscribeEvent(eventId,load,payload=>{if(Number(payload.revision)>revision) void load();});
    const connection=()=>{if(active) setConnected(socket.connected);};
    socket.on('connect',connection);socket.on('disconnect',connection);socket.on('connect_error',connection);
    // A healthy preview refreshes on changes/reconnect/return, rather than polling the DB.
    const timer=setInterval(()=>{if(document.visibilityState==='visible'&&(!preview||!socket.connected||failed)) void load();},30000);
    void load();
    return()=>{active=false;controller?.abort();unsubscribe();clearInterval(timer);
      socket.off('connect',connection);socket.off('disconnect',connection);socket.off('connect_error',connection);};
  },[eventId,preview]);
  async function submit(event) {
    event.preventDefault();if(!user || busy || !text.trim()) return;
    const target=eventId;setBusy(true);setError('');
    try {await addComment(target,text.trim());if(activeEvent.current===target) {setText('');await refresh.current();}}
    catch(failure) {if(activeEvent.current===target) setError(failure.message||'Unable to post comment');}
    finally {if(activeEvent.current===target) setBusy(false);}
  }
  async function remove(id) {
    const target=eventId;setBusy(true);setError('');
    try {await removeComment(target,id);if(activeEvent.current===target) await refresh.current();}
    catch(failure) {if(activeEvent.current===target) setError(failure.message||'Unable to delete comment');}
    finally {if(activeEvent.current===target) setBusy(false);}
  }
  const Heading=preview?'h3':'h2';
  return <section id="comments" aria-labelledby="comments-title" className={`event-comments ${preview?'comments-preview':''}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><Heading id="comments-title" tabIndex={-1} className="text-lg font-semibold">{preview?'Recent comments':'Comments'}{!loading&&<span className="comment-total">{total}</span>}</Heading>
      <span role="status" className="text-xs muted ml-auto text-right flex flex-col gap-1">
        <span>{connected?'Live updates':'Reconnecting…'}</span>
        {!connected&&(lastUpdated?<span>Last updated <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'})}</time></span>:!loading&&<span>No successful refresh yet.</span>)}
      </span></div>
    {preview&&total>comments.length&&<p className="text-sm muted">Showing the latest {comments.length} comments.</p>}
    {error && <p role="alert" className="text-error text-sm">{error}</p>}
    {loading && <p role="status" className="text-sm">Loading comments…</p>}
    <ul className="space-y-3" aria-live="polite" aria-relevant="additions removals">
      {!loading && comments.length===0 && <li className="muted text-sm">No comments yet. Start the conversation.</li>}
      {comments.map(comment=><li key={comment.id} className="rounded-xl bg-base-100 p-3">
        <div className="flex items-start justify-between gap-2"><span className="font-medium text-sm">{comment.user?.name||'Community member'}</span>
          {user && (String(user.id)===String(comment.user?.id)||user.role==='admin') &&
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete comment by ${comment.user?.name||'community member'}`} disabled={busy} onClick={()=>remove(comment.id)}>Delete</button>}</div>
        <p className="comment-text my-2 whitespace-pre-wrap break-words text-sm">{comment.text}</p>
        <time dateTime={comment.createdAt} className="text-xs muted">{new Date(comment.createdAt).toLocaleString()}</time>
      </li>)}
    </ul>
    {preview&&total>0&&<Link className="btn btn-outline w-full" to={`/events/${eventId}#comments`} target="_blank" rel="noopener noreferrer">View all {total} {total===1?'comment':'comments'} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></Link>}
    {user?<form onSubmit={submit} className="comment-composer">
      <label htmlFor={`comment-${eventId}`} className="text-sm font-medium">{user?'Add a comment':'Sign in to join the conversation'}</label>
      <textarea ref={composer} id={`comment-${eventId}`} value={text} onChange={event=>setText(event.target.value)} maxLength={5000}
        className="textarea textarea-bordered w-full min-h-24" disabled={!user||busy} placeholder={user?'Share something helpful…':'Sign in using the button above'}/>
      <button className="btn btn-primary self-end" disabled={!user||busy||!text.trim()}>{busy?'Saving…':'Post comment'}</button>
    </form>:<div className="comment-sign-in"><p className="text-sm muted">Have a question or a tip for other visitors?</p><button className="btn btn-outline" onClick={signIn}>Sign in to comment</button></div>}
  </section>;
}
