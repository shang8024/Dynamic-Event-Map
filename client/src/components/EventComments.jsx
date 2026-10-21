import {useEffect,useRef,useState} from 'react';
import {fetchComments,addComment,removeComment} from '../services/commentsService';
import socket,{subscribeEvent} from '../services/socket';
import {useAuth} from '../contexts/AuthContext';
import {useAuthAction} from '../contexts/AuthFlowContext';
export default function EventComments({eventId}) {
  const {user}=useAuth();
  const [comments,setComments]=useState([]),[text,setText]=useState(''),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[connected,setConnected]=useState(socket.connected),[loading,setLoading]=useState(true);
  const refresh=useRef(()=>{}),activeEvent=useRef(eventId);
  const composer=useRef(null);
  const signIn=useAuthAction(()=>composer.current?.focus(),'join this conversation');
  useEffect(()=>{
    let active=true,generation=0,controller,revision=-1;
    activeEvent.current=eventId;setComments([]);setText('');setError('');setLoading(true);
    async function load() {
      const request=++generation;controller?.abort();controller=new AbortController();
      try {
        const snapshot=await fetchComments(eventId,controller.signal);
        if(!active || request!==generation || Number(snapshot.revision)<revision) return;
        revision=Number(snapshot.revision);setComments(snapshot.comments);setError('');
      } catch(failure) {if(active && request===generation && failure.name!=='AbortError') setError('Unable to refresh comments. Retrying automatically.');}
      finally {if(active && request===generation) setLoading(false);}
    }
    refresh.current=load;
    const unsubscribe=subscribeEvent(eventId,load,payload=>{if(Number(payload.revision)>revision) void load();});
    const connection=()=>{if(active) setConnected(socket.connected);};
    socket.on('connect',connection);socket.on('disconnect',connection);socket.on('connect_error',connection);
    const timer=setInterval(()=>{if(document.visibilityState==='visible') void load();},30000);
    void load();
    return()=>{active=false;controller?.abort();unsubscribe();clearInterval(timer);
      socket.off('connect',connection);socket.off('disconnect',connection);socket.off('connect_error',connection);};
  },[eventId]);
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
  return <section aria-label="Event comments" className="event-comments">
    <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">Comments</h3>
      <span role="status" className="text-xs muted">{connected?'Live updates':'Reconnecting…'}</span></div>
    {error && <p role="alert" className="text-error text-sm">{error}</p>}
    {loading && <p role="status" className="text-sm">Loading comments…</p>}
    <ul className="space-y-3" aria-live="polite" aria-relevant="additions removals">
      {!loading && comments.length===0 && <li className="muted text-sm">No comments yet. Start the conversation.</li>}
      {comments.map(comment=><li key={comment.id} className="rounded-xl bg-base-100 p-3">
        <div className="flex items-start justify-between gap-2"><span className="font-medium text-sm">{comment.user?.name||'Community member'}</span>
          {user && (String(user.id)===String(comment.user?.id)||user.role==='admin') &&
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete comment by ${comment.user?.name||'community member'}`} disabled={busy} onClick={()=>remove(comment.id)}>Delete</button>}</div>
        <p className="my-2 whitespace-pre-wrap break-words text-sm">{comment.text}</p>
        <time dateTime={comment.createdAt} className="text-xs muted">{new Date(comment.createdAt).toLocaleString()}</time>
      </li>)}
    </ul>
    {user?<form onSubmit={submit} className="comment-composer">
      <label htmlFor={`comment-${eventId}`} className="text-sm font-medium">{user?'Add a comment':'Sign in to join the conversation'}</label>
      <textarea ref={composer} id={`comment-${eventId}`} value={text} onChange={event=>setText(event.target.value)} maxLength={5000}
        className="textarea textarea-bordered w-full min-h-24" disabled={!user||busy} placeholder={user?'Share something helpful…':'Sign in using the button above'}/>
      <button className="btn btn-primary self-end" disabled={!user||busy||!text.trim()}>{busy?'Saving…':'Post comment'}</button>
    </form>:<div className="comment-sign-in"><p className="text-sm muted">Have a question or a tip for other visitors?</p><button className="btn btn-outline" onClick={signIn}>Sign in to comment</button></div>}
  </section>;
}
