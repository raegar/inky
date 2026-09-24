/*
    Example Story: The Forest Path
    Demonstrates images and audio in Ink.
*/

-> forest_start



=== forest_start ===

You step into a quiet forest clearing. The air is still. # AUDIOLOOP forest_ambience.mp3
Sunlight filters through the trees. # IMAGE clearing.jpg


*   [Follow the path forward]
    The dirt path winds deeper into the woods. # IMAGE path.jpg
    Birds scatter at your footsteps. # AUDIO birds.wav
    A tree creaks somewhere overhead. # AUDIO log_creak.wav
    -> pause_follow_path               

*   [Sit on the old log]
    You rest for a moment on a mossy log. The wood groans beneath you. #AUDIO log_creak.wav
    You notice strange carvings in the bark. #IMAGE carvings.jpg
    -> forest_log



=== pause_follow_path ===
+   [Continue down the path]
    -> forest_deeper



=== forest_deeper ===
The trees grow darker and crowd closer. The wind carries a faint whisper… # AUDIOLOOP whisper.wav
A glimmer of light shines ahead. # IMAGE dark_forest.jpg

*   [Investigate the lantern]
    You reach for the lantern; its glow steadies. The whispers fade. # AUDIOSTOP: loop
    -> forest_end

*   [Turn back]
    Uneasy, you retrace your steps to the clearing. # AUDIOSTOP: loop
    -> forest_start



=== forest_log ===
The carvings form a spiral. Staring at it makes your head spin.  
The forest itself seems to lean closer. # AUDIO strange_tone.wav

*   [Stand up quickly]
    You shake your head and stand. The dizziness fades. # AUDIOSTOP: once
    -> forest_start

*   [Touch the carvings] # AUDIOSTOP: once
    Your fingers trace the spiral. A hidden compartment pops open, revealing a lantern. # IMAGE lantern.jpg  # AUDIO wood_slide.wav
    -> pause_take_lantern

=== pause_take_lantern===
+   [Take the lantern]
    -> forest_end



=== forest_end ===
The lantern glows warmly in your hands. #IMAGE forest_glow.jpg  
Somehow, you feel safer.  
The forest is quiet. # AUDIOLOOP calm_music.mp3

-> END
