/** Owned delayed work. Epoch checks also suppress callbacks already queued by the browser. */
export function createLifecycle({setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let runEpoch=0,battleEpoch=0;
  const pending=new Map();
  function schedule(callback,ms,battle) {
    const run=runEpoch, fight=battleEpoch;
    const id=setTimer(()=>{
      pending.delete(id);
      if(run!==runEpoch || (battle && fight!==battleEpoch)) return;
      callback();
    },ms);
    pending.set(id,battle);
    return id;
  }
  function resetBattle() {
    battleEpoch++;
    for(const [id,battle] of pending)if(battle){clearTimer(id);pending.delete(id)}
  }
  function resetRun() {
    runEpoch++;battleEpoch++;
    for(const id of pending.keys())clearTimer(id);
    pending.clear();
  }
  return {scheduleRun:(fn,ms)=>schedule(fn,ms,false),scheduleBattle:(fn,ms)=>schedule(fn,ms,true),resetRun,resetBattle};
}
