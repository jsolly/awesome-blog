// Preserve the document's prior print mode, including browser-menu printing.
export function createRecipePrintSession(mode,prepared=()=>{},restored=()=>{}) {
  let previous=null;
  let owns=false;
  function prepare(){
    if(!owns){previous=document.documentElement.getAttribute('data-recipe-print');owns=true;}
    document.documentElement.setAttribute('data-recipe-print',mode());prepared();
  }
  function restore(){
    if(owns){if(previous===null)document.documentElement.removeAttribute('data-recipe-print');else document.documentElement.setAttribute('data-recipe-print',previous);}
    owns=false;restored();
  }
  function listen(){
    window.addEventListener('beforeprint',prepare);window.addEventListener('afterprint',restore);
    return ()=>{window.removeEventListener('beforeprint',prepare);window.removeEventListener('afterprint',restore);restore();};
  }
  return {prepare,restore,listen};
}
