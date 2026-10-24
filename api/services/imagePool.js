const {ImageError}=require('./imageErrors');

function createImagePool({concurrency,maximumQueue=24,waitMs=6000}) {
  let active=0;const queue=[];
  async function acquire(signal) {
    if(signal?.aborted) throw new ImageError('IMAGE_TIMEOUT');
    if(active<concurrency) {active++;return;}
    if(queue.length>=maximumQueue) throw new ImageError('IMAGE_BUSY');
    await new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(item.timer);signal?.removeEventListener('abort',aborted);
        const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);
        if(error)reject(error);else resolve();};
      const aborted=()=>finish(new ImageError('IMAGE_TIMEOUT'));
      const item={resolve:()=>finish(),timer:setTimeout(()=>finish(new ImageError('IMAGE_BUSY')),waitMs)};
      queue.push(item);signal?.addEventListener('abort',aborted,{once:true});
    });
  }
  function release(){const next=queue.shift();if(next)next.resolve();else active--;}
  return {async run(task,signal){await acquire(signal);try {if(signal?.aborted)throw new ImageError('IMAGE_TIMEOUT');return await task();}finally {release();}}};
}
module.exports={createImagePool};
