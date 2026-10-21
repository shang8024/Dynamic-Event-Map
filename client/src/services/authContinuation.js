// Coordinate the handoff between native dialogs. A cancelled or replaced sign-in
// must never run an old action, including during the frame after it completes.
export function createAuthContinuation(schedule) {
  let pending=null,revision=0;
  return {
    set(action) {revision++;pending=action;},
    cancel() {revision++;pending=null;},
    complete() {
      const action=pending,expected=revision;pending=null;
      if(action) schedule(()=>{if(revision===expected) action();});
    },
  };
}
