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

  // Get the video path based on exercise name and difficulty
  const videoConfig = getExerciseVideo(exerciseName, difficulty);
  const referenceVideo = videoConfig?.path;

  // Initialize camera on mount
  useEffect(() => {
    console.log('Initializing camera on mount');
    if (!videoRef.current || !canvasRef.current) {
      console.log('User video or canvas not ready');
      return;
    }

    const initializeCamera = async () => {
      try {
        console.log('Requesting camera access');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            console.log('Camera stream loaded');
            if (videoRef.current) {
              videoRef.current.play();
            }
          };
        }
      } catch (err) {
        console.error('Camera access error:', err);
        setCameraError('Could not access camera. Please ensure you have granted camera permissions.');
        toast({
          title: "Camera Error",
          description: "Could not access camera. Please ensure you have granted camera permissions.",
          variant: "destructive",
        });
      }
    };

    initializeCamera();

    return () => {
      console.log('Cleaning up camera stream');
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [toast]);

  // Initialize reference video pose detection
  useEffect(() => {
    console.log('Initializing reference video pose detection');
    if (!referenceVideoRef.current || !referenceCanvasRef.current) {
      console.log('Reference video or canvas not ready');
      return;
    }

    let referencePose: Pose | null = null;

    const initializePose = async () => {
      try {
        // First ensure the reference video is loaded
        if (referenceVideoRef.current) {
          await new Promise((resolve, reject) => {
            if (!referenceVideoRef.current) return reject('No video element');
            referenceVideoRef.current.onloadeddata = resolve;
            referenceVideoRef.current.onerror = reject;
            referenceVideoRef.current.load();
          });
        }

        // Load MediaPipe from Google's CDN
        referencePose = new Pose({
          locateFile: (file) => {
            console.log('Loading MediaPipe file:', file);
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
          },
        });

        await referencePose.initialize();
        
        referencePose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: true,
          smoothSegmentation: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        referencePose.onResults((results) => {
          if (!referenceCanvasRef.current) return;
          const canvasCtx = referenceCanvasRef.current.getContext('2d');
          if (!canvasCtx) return;
          
          if (results.poseLandmarks && isRefTracking) {
            console.log('Reference pose detected, frame count:', frameCount);
            if (frameCount % FRAME_INTERVAL === 0) {
              console.log('Reference pose vector:', results.poseLandmarks);
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

        // Process reference video frames
        const processReferenceFrame = async () => {
          if (referenceVideoRef.current && !referenceVideoRef.current.paused && isRefTracking && referencePose) {
            try {
              await referencePose.send({ image: referenceVideoRef.current });
              requestAnimationFrame(processReferenceFrame);
            } catch (error) {
              console.error('Error processing reference frame:', error);
            }
          }
        };

        if (isRefTracking) {
          if (referenceVideoRef.current) {
            try {
              await referenceVideoRef.current.play();
              requestAnimationFrame(processReferenceFrame);
            } catch (error) {
              console.error('Error playing reference video:', error);
              toast({
                title: "Error",
                description: "Failed to play reference video. Please try again.",
                variant: "destructive",
              });
            }
          }
        } else {
          if (referenceVideoRef.current) {
            referenceVideoRef.current.pause();
          }
        }
      } catch (error) {
        console.error('Error initializing MediaPipe Pose:', error);
        toast({
          title: "Error",
          description: "Failed to initialize pose detection. Please try again.",
          variant: "destructive",
        });
      }
    };

    initializePose();

    return () => {
      console.log('Cleaning up reference pose detection');
      if (referencePose) {
        referencePose.close();
      }
    };
  }, [isRefTracking, toast]);

  // Initialize user video and pose detection
  useEffect(() => {
    console.log('Initializing user pose detection, isUserTracking:', isUserTracking);
    if (!videoRef.current || !canvasRef.current || !isUserTracking) return;

    let userPose: Pose | null = null;

    const initializePose = async () => {
      try {
        // Load MediaPipe from Google's CDN
        userPose = new Pose({
          locateFile: (file) => {
            console.log('Loading MediaPipe file:', file);
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
          },
        });

        await userPose.initialize();

        userPose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: true,
          smoothSegmentation: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        userPose.onResults((results) => {
          if (!canvasRef.current) return;
          const canvasCtx = canvasRef.current.getContext('2d');
          if (!canvasCtx) return;
          
          if (results.poseLandmarks && isUserTracking) {
            console.log('User pose detected, frame count:', frameCount);
            if (frameCount % FRAME_INTERVAL === 0) {
              console.log('User pose visibility:', results.poseLandmarks.map(lm => lm.visibility));
              console.log('Collecting user pose frame', results.poseLandmarks);
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

        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && userPose) {
              try {
                await userPose.send({ image: videoRef.current });
              } catch (error) {
                console.error('Error processing user frame:', error);
              }
            }
          },
          width: 640,
          height: 480,
        });

        if (isUserTracking) {
          console.log('Starting camera for pose detection');
          camera.start();
        }

        return () => {
          console.log('Cleaning up user pose detection');
          camera.stop();
          if (userPose) {
            userPose.close();
          }
        };
      } catch (error) {
        console.error('Error initializing MediaPipe Pose:', error);
        toast({
          title: "Error",
          description: "Failed to initialize pose detection. Please try again.",
          variant: "destructive",
        });
      }
    };

    initializePose();
  }, [isUserTracking, toast]);

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