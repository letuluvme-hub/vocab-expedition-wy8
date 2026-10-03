import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceProfile} from '../../src/services/device.js';
test('native bridge and Android WebView always hide desktop help, even on a wide display',()=>{
 for(const e of [{__androidTTS:{},matchMedia:()=>({matches:true})},{navigator:{userAgent:'Mozilla/5.0 (Linux; Android 15; wv)'}}])assert.deepEqual(deviceProfile(e),{android:true,desktop:false});
});
test('ordinary phone browsers keep the download but hide computer hints; desktop needs a fine pointer',()=>{
 assert.deepEqual(deviceProfile({navigator:{userAgent:'iPhone Mobile'}}),{android:false,desktop:false});
 assert.deepEqual(deviceProfile({navigator:{userAgent:'Android Chrome Mobile'}}),{android:false,desktop:false});
 assert.equal(deviceProfile({matchMedia:()=>({matches:true})}).desktop,true);
 assert.equal(deviceProfile({matchMedia:()=>({matches:false})}).desktop,false);
});
