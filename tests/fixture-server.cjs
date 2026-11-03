const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const gameRoot =
  "E:/__pTSern/PLACore/build/WonderMatch_RF_RoyaleEscape_HWTheme_2_2_2";
const engine2 = "E:/__pTSern/cocos-engine/bin/cocos2d-js-for-preview.js";
const harness = `<!doctype html><html><head><meta charset="utf-8"><title>Actual Cocos 2.4.5 inspector fixture</title><style>body{margin:0;background:#222;color:white}canvas{display:block;width:960px;height:640px;max-width:100vw}</style></head><body><canvas id="GameCanvas" width="960" height="640"></canvas><script src="/engine2.js"></script><script>
cc.game.run({id:'GameCanvas',debugMode:1,showFPS:false,frameRate:30,width:960,height:640,renderMode:0,jsList:[],groupList:['default'],collisionMatrix:[[true]]},function(){
cc.view.setDesignResolutionSize(960,640,cc.ResolutionPolicy.SHOW_ALL);
var scene=new cc.Scene();scene.name='InspectorFixture';
var canvas=new cc.Node('Canvas');canvas.parent=scene;canvas.setContentSize(960,640);canvas.setPosition(480,320);var canvasComp=canvas.addComponent(cc.Canvas);canvasComp.designResolution=cc.size(960,640);
var Fixture=cc.Class({name:'InspectorFixtureComponent',extends:cc.Component,properties:{score:7,caption:'Editable fixture text',flag:true,mode:{default:0,type:cc.Enum({Easy:0,Hard:1})},target:cc.Node,values:{default:[1,2,3],type:[cc.Integer]}},onTap:function(){this.score++}});
var group=new cc.Node('EditableGroup');group.parent=canvas;group.setPosition(0,0);group.setContentSize(300,180);var comp=group.addComponent(Fixture);var widget=group.addComponent(cc.Widget);widget.isAlignTop=true;widget.top=20;widget.isAlignLeft=true;widget.left=30;
var source=document.createElement('canvas');source.width=64;source.height=64;var ctx=source.getContext('2d');ctx.fillStyle='#209eda';ctx.fillRect(0,0,64,64);var texture=new cc.Texture2D();texture.initWithElement(source);texture.handleLoadedTexture();var frame=new cc.SpriteFrame(texture);
var sprite=new cc.Node('InspectableSprite');sprite.parent=group;sprite.setContentSize(128,128);var spriteComp=sprite.addComponent(cc.Sprite);spriteComp.spriteFrame=frame;spriteComp.sizeMode=cc.Sprite.SizeMode.CUSTOM;
var anim=sprite.addComponent(cc.Animation);var clip=cc.AnimationClip.createWithSpriteFrames([frame,frame],2);clip.name='FixtureClip';anim.addClip(clip);
var labelNode=new cc.Node('InspectableLabel');labelNode.parent=canvas;labelNode.setPosition(0,130);var label=labelNode.addComponent(cc.Label);label.string='Cocos 2.4.5 inspector fixture';label.fontSize=28;
var inactive=new cc.Node('InactiveNode');inactive.parent=group;inactive.active=false;comp.target=sprite;
var button=sprite.addComponent(cc.Button);var handler=new cc.Component.EventHandler();handler.target=group;handler.component='InspectorFixtureComponent';handler.handler='onTap';button.clickEvents=[handler];
cc.director.runSceneImmediate(scene);window.fixture={scene:scene,canvas:canvas,group:group,component:comp,sprite:sprite,spriteComp:spriteComp,label:label,frame:frame,texture:texture,animation:anim,widget:widget};window.fixtureReady=true;
});</script></body></html>`;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
};
const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url.pathname === "/v2/" || url.pathname === "/v2") {
    res.setHeader("Content-Type", "text/html");
    res.end(harness);
    return;
  }
  if (url.pathname === "/plain/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      "<!doctype html><title>No engine</title><h1>No engine fixture</h1>",
    );
    return;
  }
  if (url.pathname === "/frames/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><title>Frame routing fixture</title><iframe title="Game" src="/v2/" width="960" height="640"></iframe><iframe title="No engine" src="/plain/"></iframe>',
    );
    return;
  }
  let file;
  if (url.pathname === "/engine2.js") file = engine2;
  else if (url.pathname.startsWith("/v3/")) {
    const relative = decodeURIComponent(url.pathname.slice(4)) || "index.html";
    file = path.resolve(gameRoot, relative);
    if (!file.startsWith(path.resolve(gameRoot) + path.sep)) {
      res.writeHead(403).end();
      return;
    }
  } else {
    res.writeHead(404).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(file).pipe(res);
  });
});
server.listen(18764, "127.0.0.1", () => console.log("pts-real-fixtures-ready"));
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
