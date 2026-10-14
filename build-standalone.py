from pathlib import Path
import re
p=Path(__file__).parent
text=(p/'index.html').read_text()
text=text.replace('<head>','<head>\n<meta name="tdb-standalone" content="true">')
text=re.sub(r'<link rel="stylesheet" href="\./styles.css[^\"]*">',lambda _: '<style>\n'+(p/'styles.css').read_text()+'\n</style>',text)
for filename in ['data.js','engine.js','online.js','app.js']:
 text=re.sub(r'<script src="\./'+re.escape(filename)+r'[^\"]*"></script>',lambda _,f=filename:'<script>\n'+(p/f).read_text()+'\n</script>',text)
text=re.sub(r'<link rel="(?:manifest|icon)"[^>]*>','',text)
(p/'todofuken-draft-standalone.html').write_text(text)
print(len(text.encode()),'bytes')
