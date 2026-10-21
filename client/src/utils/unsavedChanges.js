export function pendingUnsavedChanges(guards,bypass=new Set()) {
  return [...guards].filter(([id,guard])=>!bypass.has(id)&&(guard.dirty||guard.busy)).map(([,guard])=>guard);
}

export function blocksUnsavedNavigation(guards,current,next,bypass) {
  return (current.pathname!==next.pathname||current.search!==next.search)&&pendingUnsavedChanges(guards,bypass).length>0;
}
