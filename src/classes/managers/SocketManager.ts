import * as lessMiddleware from 'less-middleware';
import * as express from 'express';
import * as socketIo from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import IManager from '../interfaces/IManager';
import Game from '../Game';
import BaseManager from './BaseManager';
import Server from '../../Server';

class SocketManager extends BaseManager implements IManager {
  private app: express.Express = null;
  private server: HTTPServer = null;
  private sio: socketIo.Server = null;

  public async startup(): Promise<void> {
    this.initApp();
    this.configureApp();
    this.initHttpServer();
    this.initSockets();
  }

  public async shutdown(): Promise<void> {
    return;
  }
  
  public allowConnections(): void {
    this.startHttpListener();
    this.bindSocketEvents();
  }

  private initApp(): void {
    this.app = express();
  }

  private configureApp(): void {
    this.app.use('/css', lessMiddleware(__dirname + '/../../../public/css'));
    this.app.use(express.static(__dirname + '/../../../public'));
  }

  private initHttpServer(): void {
    this.server = createServer(this.app);
  }

  private initSockets(): void {
    this.sio = socketIo(this.server);
  }

  private startHttpListener(): void {
    if (this.server === null) {
      throw new Error('Unable to allow connections due to server not being initialized first.');
    }

    this.server.listen(3000, () => {
      console.log(`Arcadia is now available at http://127.0.0.1:3000`);
    });
  }
  
  private bindSocketEvents(): void {
    if (this.sio === null) {
      throw new Error('Unable to allow connections due to server not being initialized first.');
    }

    this.sio.on('connection', (socket: socketIo.Socket) => {
      console.log('Socket connection opened (id=%s)', socket.id);
      socket.on('login', (loginData) => Server.socketEventsManager.onLogin(socket, loginData))
    });
  }

  private bindSocketEvents_Old(): void {
    if (this.sio === null) {
      throw new Error('Unable to allow connections due to server not being initialized first.');
    }

    const GameEngine = new Game().init();

    this.sio.on('connection', function(socket) {
      console.log('Socket connection opened id=%s', socket.id);
    
      socket.on('login', function(loginData) {
        // Bind after-login events
        socket.on('location', function(locationData) {
          var playerObj = GameEngine.getPlayerBySocketId(socket.id);
          playerObj.location.x = locationData.x;
          playerObj.location.y = locationData.y;
    
          var newRoom = GameEngine.getMap(playerObj.location.map).getRoom(locationData.x, locationData.y);
          if(newRoom && newRoom.link) {
            if(!playerObj.canEdit || (playerObj.canEdit && !locationData.shiftKey)) {
              var newMap = GameEngine.getMap(newRoom.link.map);
              if( (newMap === null && playerObj.canEdit) || newMap !== null) {
                // Let's go to a new map
                var oldMap = playerObj.location.map;
                playerObj.location.map = newRoom.link.map;
                playerObj.location.x = newRoom.link.x;
                playerObj.location.y = newRoom.link.y;
                // Render new map
                playerObj.renderMap(newMap, true);
                GameEngine.getSurroundingPlayers(playerObj); // Get players around you
                GameEngine.updateSurroundingPlayers(playerObj); // Notify other players around you about yourself
                GameEngine.removePlayerFromMap(playerObj, oldMap); // Remove you from players on old map
                return;
              }
            }
          }
    
          GameEngine.updateSurroundingPlayers(playerObj);
        });
    
        socket.on('mapDraw', function(drawData) {
          var playerObj = GameEngine.getPlayerBySocketId(socket.id);
          if(!playerObj.canEdit){ return; }
    
          GameEngine.getMap(playerObj.location.map).draw(drawData, playerObj.editingObject);
    
          GameEngine.mapUpdate(playerObj, playerObj.location, drawData.symbol, playerObj.editingObject);
          playerObj.location.x++;
          GameEngine.updateSurroundingPlayers(playerObj);
        });
    
        socket.on('mapWall', function(wallData) {
          var playerObj = GameEngine.getPlayerBySocketId(socket.id);
          if(!playerObj.canEdit){ return; }
    
          // TODO: Check perms
          GameEngine.getMap(playerObj.location.map).wall(wallData);
    
          GameEngine.mapUpdateWall(playerObj, wallData);
        });
    
        socket.on('mapColor', function(colorData) {
          var playerObj = GameEngine.getPlayerBySocketId(socket.id);
          if(!playerObj.canEdit){ return; }
    
          GameEngine.getMap(playerObj.location.map).color(colorData);
    
          GameEngine.mapUpdateColor(playerObj, colorData);
        });
    
        socket.on('mapDelete', function(drawData) {
          var playerObj = GameEngine.getPlayerBySocketId(socket.id);
          if(!playerObj.canEdit){ return; }
    
          GameEngine.getMap(playerObj.location.map).undraw(drawData, playerObj.editingObject, function onObjectDelete() {
            GameEngine.doOnMapPlayers(playerObj, true, function(_player) {
              _player.socket.emit('objectDelete', {
                name: playerObj.editingObject
              });
              playerObj.editingObject = false;
              _player.socket.emit('text', 'No longer editing object. Object has been deleted.');
            });
          });
    
          GameEngine.mapUpdateDelete(playerObj, playerObj.location, playerObj.editingObject);
    
          playerObj.location.x--;
          GameEngine.updateSurroundingPlayers(playerObj);
        });
    
        socket.on('mapSay', function(sayData) {
          var playerObj = GameEngine.getPlayerBySocketId(socket.id);
          GameEngine.sayToSurroundingPlayers(playerObj, sayData.text);
        });
    
        socket.on('runCommand', function(commandData) {
          var playerObj = GameEngine.getPlayerBySocketId(socket.id);
          var command = commandData.cmd.split(' ')[0];
          var args = commandData.cmd.split(' ').splice(1);
    
          switch(command) {
            case 'animate':
              if(!playerObj.canEdit || args.length < 2){ return; }
              var animationData = { x: playerObj.location.x, y: playerObj.location.y, animation: args.join(' ') };
              GameEngine.getMap(playerObj.location.map).setAnimation(animationData);
              GameEngine.doOnMapPlayers(playerObj, true, function(_player) {
                _player.socket.emit('mapAnimation', animationData);
              });
              socket.emit('text', 'Your animation has been applied to the map.');
              break;
            case 'link':
              if(!playerObj.canEdit || args.length !== 3){ return; }
              var linkData = { x: playerObj.location.x, y: playerObj.location.y, link: { map: args[0], x: parseInt(args[1]), y: parseInt(args[2]) } };
              GameEngine.getMap(playerObj.location.map).setLink(linkData);
              GameEngine.doOnMapPlayers(playerObj, true, function(_player) {
                _player.socket.emit('mapLink', linkData);
              });
              socket.emit('text', 'Your map-link has been applied to the map.');
              break;
            case 'flag':
              if(!playerObj.canEdit || args.length !== 1){ return; }
              var flagData = { x: playerObj.location.x, y: playerObj.location.y, flag: args[0].toLowerCase() };
              var newFlags = GameEngine.getMap(playerObj.location.map).toggleFlag(flagData);
              GameEngine.doOnMapPlayers(playerObj, true, function(_player) {
                _player.socket.emit('mapFlag', {
                  x: flagData.x,
                  y: flagData.y,
                  flags: newFlags
                });
              });
              socket.emit('text', 'Your flag has been applied to the map.');
              break;
            case 'objedit':
              if(!playerObj.canEdit){ return; }
              var objHere = GameEngine.getMap(playerObj.location.map).getObjectAt(playerObj.location.x, playerObj.location.y);
              if(playerObj.editingObject) {
                playerObj.editingObject = null;
                socket.emit('text', 'You are no longer editing any objects.');
                socket.emit('editingObject', { obj: null });
              } else if(objHere) {
                socket.emit('text', 'You are now editing \'' + objHere.name + '\'.');
                socket.emit('editingObject', { obj: objHere.name });
                playerObj.editingObject = objHere.name;
              } else {
                socket.emit('text', 'There are no objects here. Hold SHIFT to see the objects around you.');
              }
              break;
            case 'objpath':
              if(!playerObj.canEdit){ return; }
              var objHere = GameEngine.getMap(playerObj.location.map).getObjectAt(playerObj.location.x, playerObj.location.y);
              if(objHere) {
                if(args.length === 0) {
                  socket.emit('text', 'The object path for ' + objHere.name + ' is: ' + objHere.path);
                } else {
                  objHere.path = args[0];
                  socket.emit('text', 'The object path has been set for ' + objHere.name + '.');
                }
              } else {
                socket.emit('text', 'There are no objects here. Hold SHIFT to see the objects around you.');
              }
              break;
            case 'objstops':
              if(!playerObj.canEdit){ return; }
              var objHere = GameEngine.getMap(playerObj.location.map).getObjectAt(playerObj.location.x, playerObj.location.y);
              if(objHere) {
                if(args.length === 0) {
                  socket.emit('text', 'The object stops for ' + objHere.name + ' are: ' + objHere.stops);
                } else {
                  objHere.stops = args[0];
                  socket.emit('text', 'The object stops have been set for ' + objHere.name + '.');
                }
              } else {
                socket.emit('text', 'There are no objects here. Hold SHIFT to see the objects around you.');
              }
              break;
            case 'objhalt':
              if(!playerObj.canEdit){ return; }
              var objHere = GameEngine.getMap(playerObj.location.map).getObjectAt(playerObj.location.x, playerObj.location.y);
              if(objHere) {
                if(objHere.halt) {
                  objHere.halt = false;
                  socket.emit('text', 'The object ' + objHere.name + ' has been resumed.');
                } else {
                  objHere.halt = true;
                  socket.emit('text', 'The object ' + objHere.name + ' has been halted.');
                }
              } else {
                socket.emit('text', 'There are no objects here. Hold SHIFT to see the objects around you.');
              }
              break;
            case 'objcreate':
              if(!playerObj.canEdit || args.length !== 1){ return; }
              var objectCreationSuccessful = GameEngine.getMap(playerObj.location.map).createObject(args[0], playerObj.location.x, playerObj.location.y);
              if(objectCreationSuccessful !== false) {
                socket.emit('text', 'An object has been created: ' + objectCreationSuccessful.name);
                GameEngine.doOnMapPlayers(playerObj, true, function(_player) {
                  _player.socket.emit('objectCreate', objectCreationSuccessful);
                });
              } else {
                socket.emit('text', 'The object could not be created.');
              }
              break;
            case 'color':
              playerObj.setBackgroundColor(args[0]);
    
              GameEngine.updateSurroundingPlayers(playerObj);
    
              socket.emit('styleupdate', playerObj.getStyle());
              socket.emit('text', 'Your background color has been changed.');
              break;
            case 'maptitle':
              if(!playerObj.canEdit || args.length < 1){ return; }
              var newMapTitle = args.join(' ');
              GameEngine.getMap(playerObj.location.map).setMapTitle(newMapTitle);
              GameEngine.doOnMapPlayers(playerObj, true, function(_player) {
                _player.socket.emit('mapTitleChange', newMapTitle);
              });
              socket.emit('text', 'The map title has been changed.');
              break;
            case 'help':
              var commands = ['color'];
              if(playerObj.canEdit) {
                ['animate', 'link', 'flag', 'objcreate', 'objedit', 'objpath', 'objstops', 'objhalt', 'maptitle'].forEach(function(c) {
                  commands.push(c);
                });
              }
              socket.emit('text', 'Commands you can use: ' + commands.join(', ') + '.');
              break;
          }
        });
      });
    
      socket.on('disconnect', function() {
        var playerObj = GameEngine.getPlayerBySocketId(socket.id);
        if(playerObj) {
          GameEngine.removePlayerFromMap(playerObj, playerObj.location.map);
          GameEngine.removePlayer(socket.id);
        }
        console.log('Socket connection closed id=%s', socket.id);
      });
    });
    
    // Handle movement ticks for objects
    setInterval(function() {
      GameEngine.eachMap(function(map) {
        if(!map.objects) {
          return;
        }
    
        map.objects.forEach(function(obj) {
    
          if(!obj.path || obj.halt === true) {
            return;
          }
    
          if(typeof obj.pathTick === 'undefined') {
            obj.pathTick = 1;
          }
    
          obj.pathTick--;
    
          if(obj.pathTick > 0) {
            return;
          }
    
          var currentPathIndex = ((typeof obj.index === 'undefined') ? -1 : obj.index);
          var nextPathIndex = currentPathIndex + 1;
    
          if(nextPathIndex > obj.path.split('|').length - 1) {
            nextPathIndex = 0;
          }
    
          if(!obj.path.split('|')[nextPathIndex]) {
            nextPathIndex = 0;
          }
    
          var oldx = obj.x;
          var oldy = obj.y;
    
          obj.x = parseInt(obj.path.split('|')[nextPathIndex].split(',')[0]);
          obj.y = parseInt(obj.path.split('|')[nextPathIndex].split(',')[1]);
          obj.pathTick = ((obj.stops && obj.stops.split('|').indexOf(obj.x.toString() + ',' + obj.y.toString()) > -1) ? 30 : 1);
          obj.index = nextPathIndex;
    
          GameEngine.doOnSurroundingPlayersUsingMap(map.name, 50, oldx, oldy, function(_player) {
            for(var r = 0; r < obj.rooms.length; r++) {
              var oldObjectRoomX = oldx + obj.rooms[r].x;
              var oldObjectRoomY = oldy + obj.rooms[r].y;
    
              if(_player.location.x === oldObjectRoomX && _player.location.y === oldObjectRoomY) {
                var playerOldRoomRelativeX = _player.location.x - oldx;
                var playerOldRoomRelativeY = _player.location.y - oldy;
    
                _player.location.x = obj.x + playerOldRoomRelativeX;
                _player.location.y = obj.y + playerOldRoomRelativeY;
    
                _player.socket.emit('playerMovement', {
                  x: _player.location.x,
                  y: _player.location.y
                });
    
                GameEngine.updateSurroundingPlayers(_player);
    
                break;
              }
            }
          });
    
          GameEngine.doOnMapPlayersUsingMap(map.name, function(_player) {
            _player.socket.emit('objectMove', {
              name: obj.name,
              x: obj.x,
              y: obj.y
            });
          });
        });
      });
    }, 1000);
    
    // De-init stuff
    process.on('SIGINT', function() {
      GameEngine.save(function() {
        process.exit();
      });
    });
  }
}

export default SocketManager;