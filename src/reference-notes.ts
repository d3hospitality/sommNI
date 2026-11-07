/** Keep provider section labels readable even when JSON flattens their spacing. */
export function referenceNotes(value:string){
 return value.replace(/https?:\/\/[^\s<>]+/g,'').replace(/\s*(APPEARANCE|LOOK|NOSE|PALATE|FINISH|PAIRING|BEHIND THE WINE):\s*/g, '\n\n$1\n').trim();
}
