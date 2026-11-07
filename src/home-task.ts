/** Open the existing task in place, retaining its draft when another task is opened. */
export function revealHomeTask(element:HTMLElement|null){
 const section=element?.closest<HTMLDetailsElement>('details.home-task');
 if(section){document.querySelectorAll<HTMLDetailsElement>('details.home-task[open]').forEach(other=>{if(other!==section)other.open=false;});section.open=true;}
}
