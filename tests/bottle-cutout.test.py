import importlib.util, io, unittest
from pathlib import Path
from PIL import Image, ImageDraw
spec=importlib.util.spec_from_file_location('worker',Path(__file__).parents[1]/'server/bottle-cutout/worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
def photo(rectangles):
 im=Image.new('RGBA',(400,700));d=ImageDraw.Draw(im)
 for r in rectangles:d.rectangle(r,fill=(12,20,14,255))
 out=io.BytesIO();im.save(out,format='PNG');return out.getvalue()
class CutoutTests(unittest.TestCase):
 def test_transparency_and_geometry(self):
  png,p=worker.cutout(photo([(150,40,250,640)]));im=Image.open(io.BytesIO(png));self.assertEqual(im.size,(384,768));self.assertEqual(im.getpixel((0,0))[3],0);self.assertEqual(p['segmentation'],'source-alpha');self.assertIsNone(p['height_cm']);self.assertAlmostEqual(p['subject_ratio_h_over_w'],601/101)
 def test_multiple_bottles_rejected(self):
  with self.assertRaisesRegex(ValueError,'More than one'):worker.cutout(photo([(50,40,130,640),(220,40,300,640)]))
 def test_cut_off_bottle_rejected(self):
  with self.assertRaisesRegex(ValueError,'photo edge'):worker.cutout(photo([(150,0,250,640)]))
 def test_label_closeup_rejected(self):
  with self.assertRaisesRegex(ValueError,'full-bottle'):worker.cutout(photo([(50,140,350,540)]))
 def test_empty_alpha_rejected(self):
  with self.assertRaisesRegex(ValueError,'No bottle'):worker.cutout(photo([]))
if __name__=='__main__':unittest.main()
