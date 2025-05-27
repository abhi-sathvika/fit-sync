import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Camera } from '@mediapipe/camera_utils';
import { Pose, Results } from '@mediapipe/pose';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useUser } from '@supabase/auth-helpers-react';
import { POSE_LANDMARKS } from '@mediapipe/pose';
import { supabase } from '@/lib/supabase';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getExerciseVideo } from '@/config/exercises';

interface WorkoutTrackerProps {
  exerciseName: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

// Only include upper-body and leg joints
const KEYPOINTS = [
  "LEFT_SHOULDER",
  "RIGHT_SHOULDER",
  "LEFT_ELBOW",
  "RIGHT_ELBOW",
  "LEFT_WRIST",
  "RIGHT_WRIST",
  "LEFT_HIP",
  "RIGHT_HIP",
  "LEFT_KNEE",
  "RIGHT_KNEE",
  "LEFT_ANKLE",
  "RIGHT_ANKLE"
] as const;

// Define limb vectors (connections between joints)
const LIMB_VECTORS = [
  ["LEFT_WRIST", "LEFT_ELBOW"],
  ["LEFT_ELBOW", "LEFT_SHOULDER"],
  ["LEFT_SHOULDER", "RIGHT_SHOULDER"],
  ["RIGHT_WRIST", "RIGHT_ELBOW"],
  ["RIGHT_ELBOW", "RIGHT_SHOULDER"],
  ["LEFT_SHOULDER", "LEFT_HIP"],
  ["RIGHT_SHOULDER", "RIGHT_HIP"],
  ["LEFT_HIP", "RIGHT_HIP"],
  ["LEFT_HIP", "LEFT_KNEE"],
  ["LEFT_KNEE", "LEFT_ANKLE"],
  ["RIGHT_HIP", "RIGHT_KNEE"],
  ["RIGHT_KNEE", "RIGHT_ANKLE"]
] as const;

const FRAME_INTERVAL = 30; // Process every 30th frame (2 frames per second at 60fps)
let frameCount = 0;

const WorkoutTracker = ({ exerciseName, difficulty }: WorkoutTrackerProps) => {
  console.log('WorkoutTracker initialized with:', { exerciseName, difficulty });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const referenceVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isUserTracking, setIsUserTracking] = useState(false);
  const [isRefTracking, setIsRefTracking] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [userPoseSequence, setUserPoseSequence] = useState<any[][]>([]);
  const [referencePoseSequence, setReferencePoseSequence] = useState<any[][]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const user = useUser();
  console.log('User state:', user);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isMediaPipeLoaded, setIsMediaPipeLoaded] = useState(false);
  const [mediaPipeError, setMediaPipeError] = useState<string | null>(null);
  const poseRef = useRef<any>(null);
  const referencePoseRef = useRef<any>(null);

  // Get the video path based on exercise name and difficulty
  const videoConfig = getExerciseVideo(exerciseName, difficulty);
  const referenceVideo = videoConfig?.path;

  // Load MediaPipe dynamically
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadMediaPipe = async () => {
      try {
        const mediapipe = await import('@mediapipe/pose');
        const Pose = mediapipe.Pose;
        
        // Initialize user pose
        poseRef.current = new Pose({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
          }
        });

        // Initialize reference pose
        referencePoseRef.current = new Pose({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
          }
        });

        // Initialize both pose instances
        await Promise.all([
          poseRef.current.initialize(),
          referencePoseRef.current.initialize()
        ]);

        // Set options for both pose instances
        [poseRef.current, referencePoseRef.current].forEach(pose => {
          pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: true,
            smoothSegmentation: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        });

        setIsMediaPipeLoaded(true);
      } catch (error) {
        console.error('Error loading MediaPipe:', error);
        setMediaPipeError('Failed to load pose detection. Please refresh the page.');
        toast({
          title: "Error",
          description: "Failed to load pose detection. Please refresh the page.",
          variant: "destructive",
        });
      }
    };

    loadMediaPipe();

    return () => {
      if (poseRef.current) {
        poseRef.current.close();
      }
      if (referencePoseRef.current) {
        referencePoseRef.current.close();
      }
    };
  }, [toast]);

  // Initialize reference video pose detection
  useEffect(() => {
    if (!isMediaPipeLoaded || !referenceVideoRef.current || !referenceCanvasRef.current) return;

    const processReferenceFrame = async () => {
      if (referenceVideoRef.current && !referenceVideoRef.current.paused && isRefTracking) {
        await referencePoseRef.current.send({ image: referenceVideoRef.current });
        requestAnimationFrame(processReferenceFrame);
      }
    };

    referencePoseRef.current.onResults((results) => {
      if (!referenceCanvasRef.current) return;
      const canvasCtx = referenceCanvasRef.current.getContext('2d');
      if (!canvasCtx) return;
      
      if (results.poseLandmarks && isRefTracking) {
        if (frameCount % FRAME_INTERVAL === 0) {
          setReferencePoseSequence(prev => [...prev, results.poseLandmarks]);
        }
        frameCount++;
      }
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, referenceCanvasRef.current.width, referenceCanvasRef.current.height);
      canvasCtx.drawImage(results.image, 0, 0, referenceCanvasRef.current.width, referenceCanvasRef.current.height);
      
      if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {
          color: '#4CAF50',
          lineWidth: 2,
        });
        drawLandmarks(canvasCtx, results.poseLandmarks, {
          color: '#2196F3',
          lineWidth: 1,
        });
      }
      canvasCtx.restore();
    });

    if (isRefTracking) {
      if (referenceVideoRef.current) {
        referenceVideoRef.current.play();
        requestAnimationFrame(processReferenceFrame);
      }
    } else {
      if (referenceVideoRef.current) {
        referenceVideoRef.current.pause();
      }
    }
  }, [isMediaPipeLoaded, isRefTracking]);

  // Initialize user video and pose detection
  useEffect(() => {
    if (!isMediaPipeLoaded || !videoRef.current || !canvasRef.current || !isUserTracking) return;

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current) {
          await poseRef.current.send({ image: videoRef.current });
        }
      },
      width: 640,
      height: 480,
    });

    poseRef.current.onResults((results) => {
      if (!canvasRef.current) return;
      const canvasCtx = canvasRef.current.getContext('2d');
      if (!canvasCtx) return;
      
      if (results.poseLandmarks && isUserTracking) {
        if (frameCount % FRAME_INTERVAL === 0) {
          setUserPoseSequence(prev => [...prev, results.poseLandmarks]);
        }
        frameCount++;
      }
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
      
      if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {
          color: '#FF4081',
          lineWidth: 2,
        });
        drawLandmarks(canvasCtx, results.poseLandmarks, {
          color: '#FF0000',
          lineWidth: 1,
        });
      }
      canvasCtx.restore();
    });

    if (isUserTracking) {
      camera.start();
    }

    return () => {
      camera.stop();
    };
  }, [isMediaPipeLoaded, isUserTracking]);

  const startTracking = () => {
    console.log('Starting workout tracking');
    setIsUserTracking(true);
    setIsRefTracking(true);
    setUserPoseSequence([]);
    setReferencePoseSequence([]);
    setScore(null);
    setBestScore(null);
    toast({
      title: "Tracking Started",
      description: "Your workout is being tracked. Try to match the reference pose!",
    });
  };

  const stopTracking = () => {
    console.log('Stopping workout tracking');
    setIsUserTracking(false);
    setIsRefTracking(false);
    if (referenceVideoRef.current) {
      referenceVideoRef.current.pause();
    }
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    toast({
      title: "Tracking Stopped",
      description: "Your workout session has ended.",
    });
  };

  // Helper to clean pose data
  function cleanPoseSequence(sequence: any[][]) {
    return sequence.map(frame => {
      const jointCoords: number[][] = [];
      const jointVisibility: number[] = [];

      KEYPOINTS.forEach(keypoint => {
        const index = POSE_LANDMARKS[keypoint as keyof typeof POSE_LANDMARKS];
        const landmark = frame[index];
        if (landmark) {
          jointCoords.push([landmark.x, -landmark.y, -landmark.z]);
          jointVisibility.push(landmark.visibility ?? 0);
        } else {
          jointCoords.push([0, 0, 0]);
          jointVisibility.push(0);
        }
      });

      return {
        coords: jointCoords,
        visibility: jointVisibility
      };
    });
  }

  // Function to submit score
  async function submitScore() {
    console.log('Submitting score, user:', user);
    if (!user) {
      console.log('No user logged in');
      toast({ title: 'Not logged in', description: 'Please log in to submit your score.', variant: 'destructive' });
      return;
    }
    if (userPoseSequence.length === 0 || referencePoseSequence.length === 0) {
      console.log('No pose data available:', { userPoseSequenceLength: userPoseSequence.length, referencePoseSequenceLength: referencePoseSequence.length });
      toast({ title: 'No pose data', description: 'No pose data to submit.', variant: 'destructive' });
      return;
    }

    const cleanedUser = cleanPoseSequence(userPoseSequence);
    const cleanedReference = cleanPoseSequence(referencePoseSequence);

    // Ensure both sequences have the same length
    const minLength = Math.min(cleanedReference.length, cleanedUser.length);
    const finalReference = cleanedReference.slice(0, minLength).map(frame => frame.coords);
    const finalUser = cleanedUser.slice(0, minLength).map(frame => frame.coords);
    const visibilityMatrix = cleanedUser.slice(0, minLength).map(frame => frame.visibility);

    console.log('Sending score request to backend');
    const response = await fetch('https://fit-sync.onrender.com/api/score', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: user.id,
        reference_poses: finalReference,
        user_poses: finalUser,
        difficulty_level: difficulty,
        visibility_matrix: visibilityMatrix
      }),
    });

    if (!response.ok) {
      console.log('String response JSON:', await response.text());
      console.error('Score submission failed:', response.status);
      const { error } = await response.json();
      toast({ title: 'Error', description: error, variant: 'destructive' });
      return;
    }

    const { score, best_score } = await response.json();
    console.log('Score received:', { score, best_score });
    setScore(score);
    setBestScore(best_score);
    toast({ title: 'Score Submitted', description: `Your score: ${(score * 100).toFixed(2)}%` });

    // Fetch recent score
    const { data: recentData, error: recentError } = await supabase
      .from('userperformance')
      .select('most_recent_score, submitted_at')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false })
      .limit(1);

    if (recentError) {
      console.error('Error fetching recent score:', recentError);
    }

    // Fetch best score
    const { data: bestData, error: bestError } = await supabase
      .from('userperformance')
      .select('most_recent_score')
      .eq('user_id', user.id)
      .order('most_recent_score', { ascending: false })
      .limit(1);

    if (bestError) {
      console.error('Error fetching best score:', bestError);
    }
  }

  const extractLandmarks = (results: Results) => {
    if (!results.poseLandmarks) return null;

    const landmarkDict: { [key: string]: [number, number, number] } = {};
    
    KEYPOINTS.forEach(keypoint => {
      const index = POSE_LANDMARKS[keypoint as keyof typeof POSE_LANDMARKS];
      const landmark = results.poseLandmarks[index];
      if (landmark) {
        landmarkDict[keypoint] = [landmark.x, -landmark.y, -landmark.z];
      }
    });

    return landmarkDict;
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon" 
            className="rounded-full bg-buddy-purple hover:bg-buddy-purple-dark" 
            onClick={() => navigate("/home")}
          >
            <ArrowLeft size={20} className="text-white" />
          </Button>
        <CardTitle className="text-2xl font-bold">
          {exerciseName} - {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
        </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {mediaPipeError ? (
          <div className="p-4 bg-red-100 rounded-lg">
            <p className="text-red-600 text-center">{mediaPipeError}</p>
          </div>
        ) : !isMediaPipeLoaded ? (
          <div className="p-4 bg-gray-100 rounded-lg">
            <p className="text-gray-600 text-center">Loading pose detection...</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <video
                  ref={videoRef}
                  className="w-full rounded-lg"
                  playsInline
                  style={{ display: 'block', transform: 'scaleX(-1)' }}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute top-0 left-0 w-full h-full"
                  width={640}
                  height={480}
                  style={{ display: 'block', transform: 'scaleX(-1)' }}
                />
                {cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-100 rounded-lg">
                    <p className="text-red-600 text-center p-4">{cameraError}</p>
                  </div>
                )}
              </div>
              {referenceVideo && (
                <div className="relative">
                  <video
                    ref={referenceVideoRef}
                    src={referenceVideo}
                    className="w-full rounded-lg"
                    loop
                    muted
                    width={640}
                    height={480}
                  />
                  <canvas
                    ref={referenceCanvasRef}
                    className="absolute top-0 left-0 w-full h-full pointer-events-none"
                    width={640}
                    height={480}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-center space-x-4">
              {!isUserTracking && !isRefTracking ? (
                <Button onClick={startTracking} className="bg-buddy-purple hover:bg-buddy-purple-dark">
                  Start Workout
                </Button>
              ) : (
                <Button onClick={stopTracking} variant="destructive">
                  Stop Workout
                </Button>
              )}
              <Button 
                onClick={submitScore} 
                disabled={isUserTracking || isRefTracking || userPoseSequence.length === 0 || referencePoseSequence.length === 0}
                className="bg-buddy-purple hover:bg-buddy-purple-dark"
              >
                Calculate Score
              </Button>
            </div>
            {score !== null && bestScore !== null && (
              <div className="mt-6 p-4 bg-buddy-purple-light/20 rounded-lg">
                <h3 className="text-lg font-semibold text-center mb-2">Similarity Score</h3>
                <div className="grid grid-cols-1 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-buddy-purple">{(score * 100).toFixed(2)}%</p>
                  </div>
                  
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

// Helper functions for drawing landmarks
const drawConnectors = (
  ctx: CanvasRenderingContext2D,
  landmarks: any,
  connections: any,
  style: { color: string; lineWidth: number }
) => {
  const { color, lineWidth } = style;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  for (const [i, j] of connections) {
    const start = landmarks[i];
    const end = landmarks[j];
    if (start && end) {
      ctx.beginPath();
      ctx.moveTo(start.x * ctx.canvas.width, start.y * ctx.canvas.height);
      ctx.lineTo(end.x * ctx.canvas.width, end.y * ctx.canvas.height);
      ctx.stroke();
    }
  }
};

const drawLandmarks = (
  ctx: CanvasRenderingContext2D,
  landmarks: any,
  style: { color: string; lineWidth: number }
) => {
  const { color, lineWidth } = style;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  for (const landmark of landmarks) {
    ctx.beginPath();
    ctx.arc(
      landmark.x * ctx.canvas.width,
      landmark.y * ctx.canvas.height,
      lineWidth * 2,
      0,
      2 * Math.PI
    );
    ctx.stroke();
  }
};

// POSE_CONNECTIONS is a constant that defines which landmarks should be connected
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // Arms
  [11, 23], [12, 24], [23, 24], // Torso
  [23, 25], [24, 26], [25, 27], [26, 28], // Legs
];

export default WorkoutTracker; 



///////////////////////////////////////////////////////////////////////////////////// Old

// import React, { useCallback, useState, useEffect, useRef } from 'react';
// import { Results } from '@mediapipe/pose';
// import { POSE_LANDMARKS } from '@mediapipe/pose';
// import { useUser } from '@supabase/auth-helpers-react';
// import { Pose } from '@mediapipe/pose';

// interface PoseLandmark {
//   x: number;
//   y: number;
//   z: number;
//   name: string;
// }

// // Only include upper-body and leg joints
// const KEYPOINTS = [
//   "LEFT_SHOULDER",
//   "RIGHT_SHOULDER",
//   "LEFT_ELBOW",
//   "RIGHT_ELBOW",
//   "LEFT_WRIST",
//   "RIGHT_WRIST",
//   "LEFT_HIP",
//   "RIGHT_HIP",
//   "LEFT_KNEE",
//   "RIGHT_KNEE",
//   "LEFT_ANKLE",
//   "RIGHT_ANKLE"
// ] as const;

// const FRAME_INTERVAL = 30; // Process every 30th frame (2 frames per second at 60fps)
// let frameCount = 0;

// const WorkoutTracker: React.FC = () => {
//   const [isRecording, setIsRecording] = useState(false);
//   const [userPoseSequence, setUserPoseSequence] = useState<PoseLandmark[][]>([]);
//   const [referencePoseSequence, setReferencePoseSequence] = useState<PoseLandmark[][]>([]);
//   const [selectedVideo, setSelectedVideo] = useState<string>('');
//   const user = useUser();
//   const poseRef = useRef<Pose | null>(null);
//   const videoRef = useRef<HTMLVideoElement>(null);
//   const cameraRef = useRef<HTMLVideoElement>(null);
//   const streamRef = useRef<MediaStream | null>(null);

//   useEffect(() => {
//     const initializePose = async () => {
//       try {
//         poseRef.current = new Pose({
//           locateFile: (file) => {
//             return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
//           }
//         });

//         await poseRef.current.initialize();

//         poseRef.current.setOptions({
//           modelComplexity: 2,
//           smoothLandmarks: true,
//           enableSegmentation: false,
//           smoothSegmentation: true,
//           minDetectionConfidence: 0.5,
//           minTrackingConfidence: 0.5
//         });

//         poseRef.current.onResults(onPoseDetected);

//         // Setup camera
//         const stream = await navigator.mediaDevices.getUserMedia({
//           video: { width: 640, height: 480 }
//         });
//         if (cameraRef.current) {
//           cameraRef.current.srcObject = stream;
//           streamRef.current = stream;
//         }
//       } catch (error) {
//         console.error('Error initializing pose detection:', error);
//       }
//     };

//     initializePose();

//     return () => {
//       if (poseRef.current) {
//         poseRef.current.close();
//         poseRef.current = null;
//       }
//       if (streamRef.current) {
//         streamRef.current.getTracks().forEach(track => track.stop());
//         streamRef.current = null;
//       }
//     };
//   }, []);

//   const extractLandmarks = (results: Results) => {
//     if (!results.poseLandmarks) return null;

//     const landmarkDict: { [key: string]: [number, number, number] } = {};
    
//     KEYPOINTS.forEach(keypoint => {
//       const index = POSE_LANDMARKS[keypoint as keyof typeof POSE_LANDMARKS];
//       const landmark = results.poseLandmarks[index];
//       if (landmark) {
//         landmarkDict[keypoint] = [landmark.x, -landmark.y, -landmark.z];
//       }
//     });

//     return landmarkDict;
//   };

//   const onPoseDetected = useCallback((results: Results) => {
//     if (frameCount % FRAME_INTERVAL === 0) {
//       const landmarks = extractLandmarks(results);
//       if (landmarks && isRecording) {
//         setUserPoseSequence(prev => [...prev, Object.values(landmarks).map(([x, y, z]) => ({ x, y, z, name: '' }))]);
//       }
//     }
//     frameCount++;
//   }, [isRecording]);

//   const submitScore = async () => {
//     if (!user || !referencePoseSequence.length || !userPoseSequence.length) {
//       alert('Please ensure you have both reference and user pose data');
//       return;
//     }

//     try {
//       const response = await fetch(`${import.meta.env.VITE_API_URL}/api/score`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//           user_id: user.id,
//           reference_poses: referencePoseSequence,
//           user_poses: userPoseSequence,
//           video_reference: selectedVideo,
//           difficulty_level: 'beginner'
//         }),
//       });

//       if (!response.ok) {
//         throw new Error(`HTTP error! status: ${response.status}`);
//       }

//       const data = await response.json();
//       console.log('Score response:', data);
//       alert(`Your score: ${data.score.toFixed(2)}`);
//     } catch (error) {
//       console.error('Error submitting score:', error);
//       alert('Error submitting score. Please try again.');
//     }
//   };

//   return (
//     <div>
//       <video
//         ref={videoRef}
//         src={selectedVideo}
//         style={{ width: '640px', height: '480px' }}
//         onLoadedMetadata={() => {
//           if (videoRef.current) {
//             videoRef.current.play();
//           }
//         }}
//       />
//       <video
//         ref={cameraRef}
//         style={{ width: '640px', height: '480px' }}
//         autoPlay
//         playsInline
//       />
//       <div>
//         <button onClick={() => setIsRecording(!isRecording)}>
//           {isRecording ? 'Stop Recording' : 'Start Recording'}
//         </button>
//         <button onClick={submitScore} disabled={!userPoseSequence.length}>
//           Submit Score
//         </button>
//       </div>
//     </div>
//   );
// };

// export default WorkoutTracker; 