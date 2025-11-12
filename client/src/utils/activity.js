// Track user activity to determine if user needs to log out
// Firebase tokens expire after 1 hour, use checkActivity every 59 minutes
let isActive = false;
const markActive = () => {
    isActive = true;
}

['mousemove','keydown','touchstart'].forEach(eventType => {
    document.addEventListener(eventType, markActive, {once: true});
});

export const checkActivity = () => {
    const activeUser = isActive;
    isActive = false;
    ['mousemove','keydown','touchstart'].forEach(eventType => {
        document.addEventListener(eventType, markActive, {once: true});
    });
    return activeUser;
}