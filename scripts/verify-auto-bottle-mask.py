from PIL import Image
from pathlib import Path
import numpy as np
import onnxruntime as ort
p=Path('../../outputs/sommNI-auto-bottles')
im=Image.open(p/'verified-bottle.jpg').convert('RGBA');scale=min(1,992/max(im.size));im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
canvas=Image.new('RGBA',(im.width+32,im.height+32),'white');canvas.alpha_composite(im,(16,16));canvas.save(p/'normalized.png')
a=np.asarray(canvas.convert('RGB').resize((320,320),Image.Resampling.BILINEAR)).astype(np.float32);a/=max(1,a.max());a=(a-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)
s=ort.InferenceSession(str(p/'u2netp.onnx'),providers=['CPUExecutionProvider']);out=s.run([s.get_outputs()[0].name],{s.get_inputs()[0].name:a.transpose(2,0,1)[None]})[0].squeeze();mask=np.round((out-out.min())/(out.max()-out.min())*255).astype(np.uint8);(p/'mask.bin').write_bytes(mask.tobytes());print('Pinned U2NetP model produced a 320×320 mask for the verified photograph.')
