import { cp, mkdir, rm } from 'node:fs/promises';
// Only browser assets are published. Backend and environment files stay private.
await rm(new URL('./dist/',import.meta.url),{recursive:true,force:true});
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});
await cp(new URL('./public/',import.meta.url),new URL('./dist/',import.meta.url),{recursive:true});
console.log('Built browser assets in dist/.');
