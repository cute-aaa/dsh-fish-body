import { AssetRegistry } from '../lib/assets.js';
const reg = new AssetRegistry(process.cwd());
const dirs = [
  'G:\\Projnew\\git\\dsh-body\\dsh-pet\\assets\\webm',
  'G:\\Projnew\\git\\dsh-body\\dsh-pet-indesktop\\assets\\characters',
  'D:\\AI\\FishChi\\body\\skins',
];
const t0 = Date.now();
const m = reg.scan(dirs);
console.log('scan ms', Date.now() - t0);
console.log('webm', m.webm.length, 'sounds', m.sounds.length, 'skins', m.skins.length, 'live2d', m.live2d.length);
console.log('sets', JSON.stringify(m.webmSets));
console.log('skins', m.skins.map(s => `${s.id}(${s.layerCount}层/${s.canvas.w}x${s.canvas.h})`).join(', '));
const sample = m.webm.filter(e => e.set).slice(0, 3).map(e => `${e.id} -> ${e.path}`);
console.log('set sample:', sample);
console.log('resolve default:', reg.resolve('webm', '待机呼吸休闲'));
console.log('resolve set:', reg.resolve('webm', 'shenshen/待机呼吸休闲'));

