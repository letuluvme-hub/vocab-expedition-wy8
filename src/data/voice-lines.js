export const VOICE_LINES={
 scholar:{   // 学者：沉稳、引经据典
  atk:  ['Precisely correct.','Textbook.','Correct by definition.','Exemplary.'],
  combo:['A pattern emerges.','Consistency. Well played.','The method works.','Elegant deduction.'],
  low:  ['My thesis is sound. Continue.','A minor setback. One more page.','I can revise this.','The margin is thin, but I remain.'],
  win:  ['Chapter complete.','A victory worth indexing.','Q.E.D. Well played.','Another entry in the record.'],
  lose: ['An inconclusive result. Again.','The margin was insufficient.','I must revise my approach.','Back to the marginalia.']},
 warrior:{   // 战士：豪爽、直来直去
  atk:  ['For glory!','Take that!','Break!','Crush it!'],
  combo:['Five strikes!','Unbroken!','Keep swinging!','Nothing stops me now!'],
  low:  ['Still standing!','Just a scratch!','I have not fallen yet!','Come on, then!'],
  win:  ['Victory! The field is mine!','A worthy fight!','Crowned!','I stand unconquered!'],
  lose: ['Cut down, but not broken.','A worthy opponent.','I will return stronger.','Honour in the fall.']},
 scout:{     // 探险家：轻快、务实
  atk:  ['Clean shot!','Target acquired!','Straight path!','No detour needed!'],
  combo:['Five in a row. Nice route!','Good footing!','Smooth passage!','Reading the trail!'],
  low:  ['Supplies running low.','Regroup and push on.','Just enough to finish.','One more step.'],
  win:  ['Objective reached!','Clean route, clear road!','Nothing in the way now!','Scouted and done!'],
  lose: ['The trail got away from me.','Wrong turn. Bad luck.','Backtrack and retry.','Lost the way.']},
 lucky:{     // 幸运儿：轻松、玩世不恭
  atk:  ['Feeling lucky!','Here goes nothing!','Best shot you have!','Fortune favours me!'],
  combo:['Five in a row? Come on!','This is my lucky streak!','Do not stop now!','The dice roll my way!'],
  low:  ['Bad luck, good luck. Next round!','The wheel turns!','Not my finest fortune.','Still got this, right?'],
  win:  ['Jackpot!','Lady luck smiles!','That was the one!','Fortune favours the bold!'],
  lose: ['Bad hand, this time.','The dice were unkind.','Shuffle and deal again!','Luck always comes back.']},
 healer:{    // 治愈师：温柔、安抚
  atk:  ['Tend to you.','Healing light.','Easy now.','I have you.'],
  combo:['Steady as a heartbeat.','Five gentle strikes.','You are doing well.','Breathe, and press on.'],
  low:  ['Stay with me. We can mend this.','Rest a moment.','I can still help.','Breathe slowly.'],
  win:  ['Peace restored.','You are safe now.','The battle is over. Rest.','Healed. Well fought.'],
  lose: ['We will try again.','Rest now. I will watch.','Every scar heals.','Come back stronger.']},
 ranger:{    // 游侠：干脆、一击脱离
  atk:  ['One arrow, one word!','Quick shot!','Straight to the mark!','Silent strike!'],
  combo:['Five clean shots!','Not a wasted motion!','Keep the rhythm!','The quarry falters!'],
  low:  ['Bad angle. Reposition!','Low on breath. One more.','Quiver nearly empty.','I can still land one.'],
  win:  ['Target down!','Clean kill!','The path is clear!','Away before they recover!'],
  lose: ['Out of arrows.','I slipped the shot.','The quarry wins this round.','Regroup in the shadows.']}
};
export const FOE_LINES={
 '词灵':     {rate:1.02, pitch:1.25, vo:'female', seed:1, lines:['Here I come!','Take this!','Face my power!','No hiding!']},
 '语素蛛':   {rate:1.12, pitch:1.55, vo:'female', seed:2, lines:['Caught in my web!','You cannot escape!','Got you!','Stay right there!']},
 '石化词素': {rate:0.78, pitch:0.55, vo:'male',   seed:3, lines:['Turn to stone!','Cannot move?','Heavy as a mountain!','Stop right there!']},
 '歧义章鱼': {rate:0.92, pitch:0.80, vo:'male',   seed:4, lines:['Eight arms. No escape!','Which meaning?','You are tangled!','Guess what I mean!']},
 '拼写幽灵': {rate:1.20, pitch:1.75, vo:'female', seed:5, lines:['A spelling curse!','Silence!','Ha ha ha!','Beware my spell!']},
 '单复数蝎': {rate:1.08, pitch:1.35, vo:'male',   seed:6, lines:['Singular or plural?','Feel my sting!','Watch my tail!','Think again!']},
 '冰封词灵': {rate:0.86, pitch:0.70, vo:'female', seed:7, lines:['Freeze!','Cold as ice!','Stay frozen!','The ice is breaking!']},
 '词形旋风': {rate:1.28, pitch:1.62, vo:'female', seed:8, lines:['Round and round!','Words are changing!','Whoosh!','Blown away!']},
 /* BOSS：专属开场白，最慢最低最有压迫感 */
 '词汇之王': {rate:0.72, pitch:0.42, vo:'male',   seed:9, volume:1,
              lines:['Face my judgment!','Lay down your pen!','The word king has arrived!','Your words belong to me!']}
};
export const ELITE_LINES=['An elite challenger!','This will not be easy!','The real battle begins!'];
