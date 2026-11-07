export function openPersonalProfile(){
 document.querySelector<HTMLButtonElement>('.tab[data-tab="settings"]')?.click();
 const profile=document.getElementById('personal-profile');if(!profile)return;
 profile.tabIndex=-1;profile.scrollIntoView({block:'start',behavior:'instant'});profile.focus({preventScroll:true});
}
