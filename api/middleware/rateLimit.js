const redis=require('../config/redis');
module.exports=require('../services/requestLimits').createRequestLimits(redis);
