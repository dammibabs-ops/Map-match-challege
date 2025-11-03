import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, setLogLevel } from 'firebase/firest'

const YOUR_FIREBASE_CONFIG_OBJECT = { apiKey: "AIzaSyDqZCESEU_0Llx5mKHUmrNYY-IGzVKyA5Y",
  authDomain: "memory-map-game-af983.firebaseapp.com",
  projectId: "memory-map-game-af983",
  storageBucket: "memory-map-game-af983.firebasestorage.app",
  messagingSenderId: "882039456283",
  appId: "1:882039456283:web:cbeb3d4dbcfca80db92ebe",
  measurementId: "G-CNZTGCQ12E" };
const EMOJIS = ['⚽', '🥅', '🏆', '👟', '🏟️', '🏅', '🥇', '🧤', '⚽', '🥅', '🏆', '👟', '🏟️', '🏅', '🥇', '🧤'];
const INITIAL_LIVES = 10;
const MOVES_PER_LIFE_LOSS = 4;
const GAME_TIME = 90; // 90 seconds
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// --- Audio Hooks and Functions ---
// (Audio logic remains unchanged)
// ... (The entire useAudio hook content) ...
const useAudio = () => {
  const audioContext = useRef(null);
  const backgroundMusicSource = useRef(null);

  useEffect(() => {
    // Initialize AudioContext on component mount
    audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    // Set up Firestore logging
    if (setLogLevel) setLogLevel('debug');
  }, []);

  const playTone = useCallback((freq, duration, type, volume = 0.5) => {
    if (!audioContext.current) return;
    const oscillator = audioContext.current.createOscillator();
    const gainNode = audioContext.current.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.current.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioContext.current.currentTime);

    gainNode.gain.setValueAtTime(volume, audioContext.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.current.currentTime + duration);

    oscillator.start();
    oscillator.stop(audioContext.current.currentTime + duration);
  }, []);

  const playSound = useMemo(() => ({
    match: () => { playTone(600, 0.08, 'square', 0.5); playTone(800, 0.15, 'square', 0.5); },
    noMatch: () => { playTone(200, 0.3, 'sine', 0.4); },
    win: () => { playTone(1000, 0.15, 'triangle'); setTimeout(() => playTone(1300, 0.15, 'triangle'), 150); setTimeout(() => playTone(1600, 0.2, 'triangle'), 300); },
    loss: () => { playTone(150, 0.5, 'sawtooth'); },
    goal: () => { playTone(1500, 0.2, 'square', 0.8); setTimeout(() => playTone(1800, 0.1, 'square', 0.8), 100); }, 
    miss: () => { playTone(100, 0.3, 'sawtooth', 0.6); }, 
    catch: () => { playTone(850, 0.1, 'sine', 0.7); },
    pop: () => { playTone(250, 0.1, 'triangle', 0.5); },
  }), [playTone]);

  const toggleBackgroundMusic = useCallback(() => {
    // Simple, looping background tone using two detuned oscillators
    if (!audioContext.current || audioContext.current.state !== 'running') return;

    if (backgroundMusicSource.current) {
      backgroundMusicSource.current.gain.gain.setValueAtTime(0, audioContext.current.currentTime);
      backgroundMusicSource.current.gain.disconnect();
      backgroundMusicSource.current.osc1.stop();
      backgroundMusicSource.current.osc2.stop();
      backgroundMusicSource.current = null;
      return false; // Music stopped
    }

    const masterGain = audioContext.current.createGain();
    masterGain.gain.setValueAtTime(0.05, audioContext.current.currentTime); // Low volume
    masterGain.connect(audioContext.current.destination);

    const createOscillator = (freq, detune) => {
      const osc = audioContext.current.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioContext.current.currentTime);
      osc.detune.setValueAtTime(detune, audioContext.current.currentTime);
      osc.connect(masterGain);
      osc.start();
      return osc;
    };

    const osc1 = createOscillator(110, 0); // A2
    const osc2 = createOscillator(110, 5); // Slightly detuned

    backgroundMusicSource.current = { gain: masterGain, osc1, osc2 };
    return true; // Music started
  }, []);
  
  // Ensure we resume context on interaction for Safari/Chrome autoplay policies
  const resumeContext = useCallback(() => {
    if (audioContext.current && audioContext.current.state === 'suspended') {
      audioContext.current.resume().then(() => {
        console.log("AudioContext resumed.");
      });
    }
  }, []);
  
  return { playSound, toggleBackgroundMusic, resumeContext };
};


// --- Firebase Hook for Authentication & Persistence ---

const useFirebase = () => {
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const appId = YOUR_FIREBASE_CONFIG_OBJECT.projectId || 'default-app-id';


  useEffect(() => {
    
    if (Object.keys(YOUR_FIREBASE_CONFIG_OBJECT).length === 0 || !YOUR_FIREBASE_CONFIG_OBJECT.projectId) {
        console.warn("Firebase config is missing. Running in non-persistent mode.");
        setIsAuthReady(true);
        return;
    }

    const app = initializeApp(YOUR_FIREBASE_CONFIG_OBJECT);
    const firestore = getFirestore(app);
    const authInstance = getAuth(app);

    setDb(firestore);

    // Authentication Listener
    const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
      if (user) {
        setUserId(user.uid);
        setIsAuthReady(true);
      } else {
        try {
            // Use anonymous sign-in for the open web deployment
            const anonymousUser = await signInAnonymously(authInstance);
            setUserId(anonymousUser.user.uid);
        } catch (error) {
          console.error("Firebase Auth failed:", error);
        } finally {
          setIsAuthReady(true);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const saveStats = useCallback(async (data) => {
    if (!db || !userId) {
      console.warn("Database or user ID not ready. Cannot save stats.");
      return;
    }
    
    try {
      // Private data path: /artifacts/{appId}/users/{userId}/stats/{docId}
      const docRef = doc(db, `artifacts/${appId}/users/${userId}/stats`, 'memory_game_stats');
      await setDoc(docRef, { ...data, timestamp: new Date(), userId: userId }, { merge: true });
      console.log("Stats saved successfully!");
    } catch (e) {
      console.error("Error saving document: ", e);
    }
  }, [db, userId, appId]);

  return { userId, isAuthReady, saveStats };
};


// --- Catch The Balloon Component ---
// (Component logic remains unchanged)
const CatchTheBalloon = ({ moves, saveStats, onRestart, onClose, playSound, mode = 'practice' }) => {
  const [barPosition, setBarPosition] = useState(0); // 0 to 100
  const [gameStopped, setGameStopped] = useState(false);
  const [bonusInfo, setBonusInfo] = useState({ bonus: 0, rating: '', finalMoves: moves });
  const intervalRef = useRef(null);
  const directionRef = useRef(1); // 1 for right, -1 for left
  
  const isWinBonus = mode === 'win_bonus';

  useEffect(() => {
    if (gameStopped) return;

    // Start the oscillating movement
    intervalRef.current = setInterval(() => {
        setBarPosition(prevPos => {
            let newPos = prevPos + directionRef.current * 5; // Move by 5 units
            
            // Check boundaries (0-100)
            if (newPos > 100) {
                newPos = 100;
                directionRef.current = -1;
            } else if (newPos < 0) {
                newPos = 0;
                directionRef.current = 1;
            }
            return newPos;
        });
    }, 50); // Fast enough for a quick reaction game

    return () => clearInterval(intervalRef.current);
  }, [gameStopped]);

  const stopGame = () => {
    if (gameStopped) return;
    setGameStopped(true);
    clearInterval(intervalRef.current);

    const finalPos = barPosition; // Position 0-100
    const distanceToCenter = Math.abs(finalPos - 50); // Center is 50, Target is 40-60

    let bonus;
    let rating = '';
    const MAX_BONUS = 10;

    if (distanceToCenter <= 5) {
        bonus = MAX_BONUS; // Perfect Timing (45-55)
        rating = `PERFECT CATCH! 🎈 -${MAX_BONUS} Moves`;
        playSound.catch();
    } else if (distanceToCenter <= 15) {
        bonus = Math.floor(MAX_BONUS / 2); // Great Timing (35-65)
        rating = `Great Timing! -${bonus} Moves`;
        playSound.catch();
    } else {
        bonus = 0; // Miss
        rating = 'POP! You missed the catch.';
        playSound.pop();
    }

    // Only apply the bonus if we are in win_bonus mode
    const finalAdjustedMoves = isWinBonus ? Math.max(0, moves - bonus) : moves;

    setBonusInfo({ bonus, rating, finalMoves: finalAdjustedMoves });

    // Save final adjusted score ONLY if it's the win bonus
    if (isWinBonus) {
        saveStats({ 
            moves: moves, 
            finalAdjustedMoves: finalAdjustedMoves, 
            timeRemaining: null, 
            won: true, 
            miniGameBonus: bonus,
            miniGamePlayed: 'balloon'
        });
    }
  };

  
  // Bar styles (20% width centered at position)
  const barStyle = {
      width: '20%',
      transform: `translateX(${barPosition - 10}%)`, // Center the 20% bar at the position
  };

  return (
    <div className="p-6 rounded-xl shadow-2xl text-center w-full max-w-sm bg-gray-800 text-white border-4 border-indigo-600">
      <h2 className="text-2xl font-extrabold text-pink-400 mb-4">
        {isWinBonus ? '🏆 Balloon Bonus Challenge!' : '🎈 Practice: Catch the Balloon'}
      </h2>
      
      {isWinBonus && (
        <p className="text-gray-300 text-sm mb-3 font-semibold">Base Moves: <span className="font-bold text-xl text-indigo-400">{moves}</span></p>
      )}

      <div className="border border-gray-700 p-3 rounded-lg mb-4">
        <h3 className="font-semibold text-lg text-white mb-2">Time your click!</h3>
        
        {/* Track */}
        <div id="mini-game-track" className="bg-gray-700 h-6 rounded-full relative overflow-hidden">
            {/* Target Zone (40%-60%) */}
            <div className="absolute left-[40%] w-[20%] h-full bg-pink-500 opacity-80 rounded-full"></div> 
            
            {/* Moving Bar */}
            <div id="mini-game-bar" 
                className={`h-full absolute bg-blue-400 rounded-full transition-none ${!gameStopped ? '' : 'transition-transform duration-300'}`} 
                style={barStyle}
            >
            </div>
        </div>
        
        <p className={`mt-3 font-bold ${bonusInfo.bonus > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {gameStopped ? bonusInfo.rating : 'Aim for the pink center zone.'}
        </p>

        <button 
          onClick={stopGame} 
          disabled={gameStopped}
          className="w-full mt-3 bg-pink-500 hover:bg-pink-600 text-white font-semibold py-3 rounded-lg transition duration-150 shadow-xl disabled:bg-gray-600"
        >
          {gameStopped ? 'RESULT' : 'CATCH!'}
        </button>
      </div>
      
      {gameStopped && (
          <div className="mt-4 p-3 bg-gray-700 rounded-lg">
            {isWinBonus ? (
                <>
                    <p className="text-xl font-bold text-green-400">Moves Saved: {bonusInfo.bonus}</p>
                    <p className="text-2xl font-bold text-indigo-400 mt-2">FINAL SCORE: {bonusInfo.finalMoves}</p>
                    <button onClick={onRestart} className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 rounded-lg transition duration-150 mt-4">
                      Play Again
                    </button>
                </>
            ) : (
                <button onClick={onClose} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-3 rounded-lg transition duration-150 mt-4">
                      Back to Game
                </button>
            )}
            
          </div>
      )}
    </div>
  );
};


// --- Score The Goal Mini-Game Component ---
// (Component logic remains unchanged)
const ScoreTheGoal = ({ moves, saveStats, onRestart, onClose, playSound, mode = 'practice' }) => {
  const [meterPosition, setMeterPosition] = useState(0); // 0 to 100
  const [gameStopped, setGameStopped] = useState(false);
  const [bonusInfo, setBonusInfo] = useState({ bonus: 0, rating: '', finalMoves: moves });
  const intervalRef = useRef(null);
  const directionRef = useRef(1); // 1 for right, -1 for left

  const isWinBonus = mode === 'win_bonus';

  useEffect(() => {
    if (gameStopped) return;

    // Start the oscillating movement for the power meter
    intervalRef.current = setInterval(() => {
        setMeterPosition(prevPos => {
            let newPos = prevPos + directionRef.current * 4; // Move by 4 units
            
            // Check boundaries (0-100)
            if (newPos > 100) {
                newPos = 100;
                directionRef.current = -1;
            } else if (newPos < 0) {
                newPos = 0;
                directionRef.current = 1;
            }
            return newPos;
        });
    }, 40); // Fast timing

    return () => clearInterval(intervalRef.current);
  }, [gameStopped]);

  const stopGame = () => {
    if (gameStopped) return;
    setGameStopped(true);
    clearInterval(intervalRef.current);

    const finalPos = meterPosition; // Position 0-100
    const distanceToCenter = Math.abs(finalPos - 50); // Center is 50, Target sweet spot is 45-55

    let bonus;
    let rating = '';
    const MAX_BONUS = 10;

    if (distanceToCenter <= 5) {
        bonus = MAX_BONUS; // Perfect Shot (45-55)
        rating = `GOAL! 🥅 PERFECT SHOT! -${MAX_BONUS} Moves`;
        playSound.goal();
    } else if (distanceToCenter <= 15) {
        bonus = Math.floor(MAX_BONUS / 2); // Good Shot (35-65)
        rating = `Near Miss! Good Aim! -${bonus} Moves`;
        playSound.goal();
    } else {
        bonus = 0; // Miss or terrible shot
        rating = 'Saved! Terrible Shot!';
        playSound.miss();
    }
    
    // Only apply the bonus if we are in win_bonus mode
    const finalAdjustedMoves = isWinBonus ? Math.max(0, moves - bonus) : moves;

    setBonusInfo({ bonus, rating, finalMoves: finalAdjustedMoves });

    // Save final adjusted score ONLY if it's the win bonus
    if (isWinBonus) {
        saveStats({ 
            moves: moves, 
            finalAdjustedMoves: finalAdjustedMoves, 
            timeRemaining: null, 
            won: true, 
            miniGameBonus: bonus,
            miniGamePlayed: 'goal'
        });
    }
  };

  
  // Bar styles (10% width centered at position)
  const barStyle = {
      width: '10%',
      transform: `translateX(${meterPosition - 5}%)`, // Center the 10% bar at the position
  };

  return (
    <div className="p-6 rounded-xl shadow-2xl text-center w-full max-w-sm bg-gray-800 text-white border-4 border-indigo-600">
      <h2 className="text-2xl font-extrabold text-green-400 mb-4">
        {isWinBonus ? '🏆 Goal Bonus Challenge!' : '⚽ Practice Penalty Kick'}
      </h2>
      
      {isWinBonus && (
        <p className="text-gray-300 text-sm mb-3 font-semibold">Base Moves: <span className="font-bold text-xl text-indigo-400">{moves}</span></p>
      )}

      <div className="border border-gray-700 p-3 rounded-lg mb-4">
        <h3 className="font-semibold text-lg text-white mb-2">Power/Accuracy Meter</h3>
        
        {/* Track */}
        <div id="mini-game-track" className="bg-gray-700 h-6 rounded-full relative overflow-hidden">
            {/* Sweet Spot Zone (45%-55%) */}
            <div className="absolute left-[45%] w-[10%] h-full bg-yellow-400 opacity-90"></div> 
            
            {/* Moving Bar */}
            <div id="mini-game-bar" 
                className={`h-full absolute bg-red-500 rounded-full transition-none ${!gameStopped ? '' : 'transition-transform duration-300'}`} 
                style={barStyle}
            >
            </div>
        </div>
        
        <p className={`mt-3 font-bold ${bonusInfo.bonus > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {gameStopped ? bonusInfo.rating : 'Hit the yellow zone for a bonus!'}
        </p>

        <button 
          onClick={stopGame} 
          disabled={gameStopped}
          className="w-full mt-3 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-3 rounded-lg transition duration-150 shadow-xl disabled:bg-gray-600"
        >
          {gameStopped ? 'RESULT' : 'KICK!'}
        </button>
      </div>
      
      {gameStopped && (
          <div className="mt-4 p-3 bg-gray-700 rounded-lg">
            {isWinBonus ? (
                <>
                    <p className="text-xl font-bold text-green-400">Moves Saved: {bonusInfo.bonus}</p>
                    <p className="text-2xl font-bold text-indigo-400 mt-2">FINAL SCORE: {bonusInfo.finalMoves}</p>
                    <button onClick={onRestart} className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 rounded-lg transition duration-150 mt-4">
                      Play Again
                    </button>
                </>
            ) : (
                <button onClick={onClose} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-3 rounded-lg transition duration-150 mt-4">
                      Back to Game
                </button>
            )}
            
          </div>
      )}
    </div>
  );
};


// --- Mini Game Selection Modal Component ---
// (Component logic remains unchanged)
const BonusSelectionModal = ({ setActiveBonusGame, onClose }) => (
    <div className="p-6 rounded-xl shadow-2xl text-center w-full max-w-xs bg-gray-800 text-white border-4 border-yellow-600">
        <h2 className="text-2xl font-extrabold text-yellow-400 mb-4">Select Practice Game</h2>
        <p className="text-sm text-gray-300 mb-5">Choose a mini-game to practice timing!</p>

        <div className="space-y-3">
            <button 
                onClick={() => setActiveBonusGame('goal')}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition duration-150 shadow-md flex items-center justify-center text-lg"
            >
                ⚽ Score the Goal
            </button>
            <button 
                onClick={() => setActiveBonusGame('balloon')}
                className="w-full bg-pink-600 hover:bg-pink-700 text-white font-semibold py-3 rounded-lg transition duration-150 shadow-md flex items-center justify-center text-lg"
            >
                🎈 Catch the Balloon
            </button>
        </div>
        <button 
            onClick={onClose}
            className="w-full mt-6 text-sm text-gray-400 hover:text-gray-200"
        >
            Cancel
        </button>
    </div>
);


// --- Card Component ---
// (Component logic remains unchanged)
const Card = ({ emoji, isFlipped, isMatched, onClick }) => (
  <div
    className={`card transition duration-300 ease-in-out transform shadow-lg
      ${isFlipped ? 'flipped bg-gray-700' : 'bg-gray-800 hover:scale-[1.03]'}
      ${isMatched ? 'matched opacity-50 cursor-default bg-emerald-900' : ''}
      flex items-center justify-center rounded-xl cursor-pointer select-none border-b-4 border-indigo-600
    `}
    style={{
    width: '70px', 
    height: '70px',
    fontSize: '14px'
    }}>  
        <div className="pt-4 mt-6 border-t border-gray-700 text-sm text-gray-500 text-center">
            User ID: {userId || 'Authenticating...'}
        </div>
    </div>
</div>
);
};
export default function App() {
    // ...
}



        
