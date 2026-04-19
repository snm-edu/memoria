 // ============================================================                                                       
  // memoria_character_setup.jsx                                                                                        
  // メモリア フクロウキャラクター アニメーション自動設定                                                               
  // ============================================================                                                       
                                                                                                                        
  (function memoriaSetup() {                                                                                            
                                                                                                                        
      var E = {                                                                                                         
                                                                                                    
          floatY: [                                                                                                     
              "freq = 0.8;",                  
              "amp  = 8;",                                                                                              
              "[value[0], value[1] + Math.sin(time * freq * Math.PI * 2) * amp]"                    
          ].join("\n"),                                                                                                 
                                                         
          breathe: [                                                                                                    
              "freq = 1.0;",                                                                        
              "amp  = 0.025;",                                                                                          
              "s = 1 + Math.sin(time * freq * Math.PI * 2) * amp;",
              "[value[0] * s, value[1] * s]"                                                                            
          ].join("\n"),                                                                             
                                                                                                                        
          eggRock: [                                                                                
              "amp  = 6;",                               
              "freq = 0.5;",                                                                                            
              "Math.sin(time * freq * Math.PI * 2) * amp"                                                               
          ].join("\n"),                                                                                                 
                                                                                                                        
          jump: [                                                                                                       
              "freq  = 1.2;",                 
              "jumpH = 18;",                                                                                            
              "t = (time * freq) % 1;",                                                             
              "bounce = t < 0.5 ? -Math.sin(t * Math.PI) * jumpH : 0;",                                                 
              "[value[0], value[1] + bounce]"            
          ].join("\n"),                                                                                                 
                                                                                                    
          wingL: [                                                                                                      
              "freq = 3.5;",              
              "amp  = 20;",                                                                                             
              "Math.sin(time * freq * Math.PI * 2) * amp"                                                               
          ].join("\n"),                                                                                                 
                                                                                                                        
          wingR: [                                                                                  
              "freq = 3.5;",                  
              "amp  = -20;",                                                                                            
              "Math.sin(time * freq * Math.PI * 2) * amp"
          ].join("\n"),                                                                                                 
                                                                                                    
          glide: [                                                                                                      
              "freq = 0.6;",                                                                        
              "tilt = 12;",               
              "Math.sin(time * freq * Math.PI * 2) * tilt"
          ].join("\n"),                                                                                                 
   
          headNod: [                                                                                                    
              "freq   = 0.4;",                                                                      
              "maxRot = 18;",
              "Math.sin(time * freq * Math.PI * 2) * maxRot"                                                            
          ].join("\n"),   
                                                                                                                        
          blink: [                                                                                  
              "blinkEvery    = 3.5;",         
              "blinkDuration = 0.12;",                                                                                  
              "t = time % blinkEvery;",                  
              "if (t < blinkDuration * 0.5) {",                                                                         
              "  scaleY = linear(t, 0, blinkDuration * 0.5, 100, 0);",                              
              "} else if (t < blinkDuration) {",                                                                        
              "  scaleY = linear(t, blinkDuration * 0.5, blinkDuration, 0, 100);",                  
              "} else {",                                                                                               
              "  scaleY = 100;",                         
              "}",                                                                                                      
              "[value[0], scaleY]"                                                                                      
          ].join("\n"),                                                                                                 
                                                                                                                        
          crownGlow: [                                                                                                  
              "freq = 1.2;",                                                                        
              "(Math.sin(time * freq * Math.PI * 2) + 1) / 2 * 30 + 70"                                                 
          ].join("\n")                                                                              
      };                                                                                                                
                                                                                                    
      function findLayer(comp, keywords) {    
          for (var i = 1; i <= comp.numLayers; i++) {
              var name = comp.layer(i).name.toLowerCase();                                                              
              for (var j = 0; j < keywords.length; j++) {                                                               
                  if (name.indexOf(keywords[j]) >= 0) return comp.layer(i);                                             
              }                                                                                                         
          }                                                                                                             
          return null;                                                                              
      }                                                                                                                 
   
      function applyExpr(layer, prop, expr) {                                                                           
          try {                                                                                     
              layer.transform[prop].expression = expr;                                                                  
              return true;                                                                          
          } catch (e) {                   
              return false;                              
          }                                                                                                             
      }                                       
                                                                                                                        
      app.beginUndoGroup("Memoria Character Setup");                                                
                                                                                                                        
      var comp = app.project.activeItem;
      if (!comp || !(comp instanceof CompItem)) {                                                                       
          alert("コンポジションを開いてから実行してください");                                      
          app.endUndoGroup();                 
          return;                                        
      }                                                  
                                                                                                                        
      var n = comp.name.toLowerCase();        
      var stage = 0;                                                                                                    
                                                                                                                        
      if      (n.indexOf("stage1") >= 0 || n.indexOf("egg")   >= 0) stage = 1;                                          
      else if (n.indexOf("stage2") >= 0 || n.indexOf("hatch") >= 0) stage = 2;                                          
      else if (n.indexOf("stage3") >= 0 || n.indexOf("chick") >= 0) stage = 3;                                          
      else if (n.indexOf("stage4") >= 0 || n.indexOf("bird")  >= 0) stage = 4;                      
      else if (n.indexOf("stage5") >= 0 || n.indexOf("eagle") >= 0) stage = 5;
      else if (n.indexOf("stage6") >= 0 || n.indexOf("owl")   >= 0) stage = 6;
      else if (n.indexOf("stage7") >= 0 || n.indexOf("wise")  >= 0) stage = 7;                                          
                                                         
      if (stage === 0) {                                                                                                
          var input = prompt("Stage number (1-7):", "1");                                                               
          if (!input) { app.endUndoGroup(); return; }                                                                   
          stage = parseInt(input, 10);                                                                                  
      }                                                                                                                 
                                                                                                                        
      var L = {                                                                                                         
          main  : findLayer(comp, ["main","body","egg","character","owl","chick","bird","eagle","wise"]),               
          head  : findLayer(comp, ["head"]),                                                                            
          wingL : findLayer(comp, ["left_wing","wing_l","leftwing"]),
          wingR : findLayer(comp, ["right_wing","wing_r","rightwing"]),                                                 
          eyeL  : findLayer(comp, ["eye_l","left_eye","eyeleft"]),                                  
          eyeR  : findLayer(comp, ["eye_r","right_eye","eyeright"]),                                                    
          crown : findLayer(comp, ["crown"])                                                        
      };                                                                                                                
                                                                                                                        
      if (!L.main && comp.numLayers > 0) L.main = comp.layer(1);                                                        
                                                                                                                        
      var applied = [];                                                                             
                                                                                                                        
      if (L.main) {                                                                                 
          if (stage !== 2) {                                                                                            
              if (applyExpr(L.main, "position", E.floatY)) applied.push("Float");                                       
          }                                   
          if (applyExpr(L.main, "scale", E.breathe)) applied.push("Breathe");                                           
      }                                                                                             
                                                                                                                        
      switch (stage) {                    
          case 1:                                                                                                       
              if (L.main  && applyExpr(L.main,  "rotation", E.eggRock)) applied.push("Egg Rock");                       
              break;      
          case 2:                                                                                                       
              if (L.main  && applyExpr(L.main,  "position", E.jump))    applied.push("Jump");       
              break;                                                                                                    
          case 3:                                                                                   
              if (L.wingL && applyExpr(L.wingL, "rotation", E.wingL))   applied.push("Wing L");
              if (L.wingR && applyExpr(L.wingR, "rotation", E.wingR))   applied.push("Wing R");                         
              break;                                     
          case 4:                                                                                                       
          case 5:                                                                                                       
              if (L.main  && applyExpr(L.main,  "rotation", E.glide))   applied.push("Glide");
              if (L.wingL && applyExpr(L.wingL, "rotation", E.wingL))   applied.push("Wing L");                         
              if (L.wingR && applyExpr(L.wingR, "rotation", E.wingR))   applied.push("Wing R");                         
              break;                                                                                                    
          case 6:                                                                                                       
          case 7:                                                                                                       
              if (L.head  && applyExpr(L.head,  "rotation", E.headNod)) applied.push("Head Nod");   
              if (L.wingL && applyExpr(L.wingL, "rotation", E.wingL))   applied.push("Wing L");                         
              if (L.wingR && applyExpr(L.wingR, "rotation", E.wingR))   applied.push("Wing R");                         
              if (L.eyeL  && applyExpr(L.eyeL,  "scale",    E.blink))   applied.push("Blink L");                        
              if (L.eyeR  && applyExpr(L.eyeR,  "scale",    E.blink))   applied.push("Blink R");                        
              if (stage === 7 && L.crown && applyExpr(L.crown, "opacity", E.crownGlow))                                 
                  applied.push("Crown Glow"); 
              break;                                                                                                    
      }                                                                                                                 
                                                                                                                        
      app.endUndoGroup();                                                                                               
                                                                                                                        
      var msg = "Stage " + stage + " - Done!\n\nApplied:\n";                                                            
      for (var i = 0; i < applied.length; i++) msg += "  * " + applied[i] + "\n";                   
      if (applied.length === 0) msg += "  (no matching layers found)\n";                                                
      msg += "\nPress Space to preview.";                                                           
      alert(msg);                                                                                                       
                                                         
  })();   