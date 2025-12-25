function asPositiveInt(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return fallback;
}

function asPositiveNumber(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return fallback;
}

function normalizeWav2LipMode(value) {
  if (value === 'repetitive') {
    return 'repetitive';
  }
  return 'sequential';
}

function asMode(value) {
  return value === 'video' ? 'video' : 'image';
}

function asLipsyncFlag(value) {
  if (value === false || value === 'off') return false;
  return true;
}

function buildUiWorkflowNode({ id, type, pos, size, inputs = [], outputs = [], widgets = [], order = 0 }) {
  return {
    id,
    type,
    pos,
    size,
    flags: {},
    order,
    mode: 0,
    inputs,
    outputs,
    properties: { 'Node name for S&R': type },
    widgets_values: widgets,
  };
}

function buildUiWorkflow({ mode = 'image', lipsync = 'on' } = {}) {
  const normalizedMode = asMode(mode);
  const lipsyncEnabled = asLipsyncFlag(lipsync);
  const nodes = [];
  const links = [];
  let nextNodeId = 1;
  let nextLinkId = 1;

  const createLink = (sourceNode, sourceSlot, targetNode, targetSlot, typeName) => {
    const linkId = nextLinkId++;
    const link = [linkId, sourceNode.id, sourceSlot, targetNode.id, targetSlot, typeName];
    links.push(link);
    if (sourceNode.outputs?.[sourceSlot]) {
      sourceNode.outputs[sourceSlot].links = sourceNode.outputs[sourceSlot].links || [];
      sourceNode.outputs[sourceSlot].links.push(linkId);
    }
    if (targetNode.inputs?.[targetSlot]) {
      targetNode.inputs[targetSlot].link = linkId;
    }
    return linkId;
  };

  if (normalizedMode === 'image') {
    const loadImage = buildUiWorkflowNode({
      id: nextNodeId++,
      type: 'LoadImage',
      pos: [-600, -100],
      size: [220, 140],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [], slot_index: 0 }],
      widgets: ['', 'image'],
    });

    if (lipsyncEnabled) {
      const repeatBatch = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'RepeatImageBatch',
        pos: [-340, -100],
        size: [220, 170],
        inputs: [
          { name: 'image', type: 'IMAGE', link: null },
          { name: 'amount', type: 'INT', link: null, default: 25 },
        ],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [], slot_index: 0 }],
        widgets: [25],
        order: 1,
      });

      const loadAudio = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'LoadAudio',
        pos: [-340, 160],
        size: [220, 120],
        outputs: [{ name: 'AUDIO', type: 'AUDIO', links: [], slot_index: 0 }],
        widgets: [''],
        order: 2,
      });

      const wav2lip = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'VIDAX_Wav2Lip',
        pos: [0, 40],
        size: [320, 200],
        inputs: [
          { name: 'images', type: 'IMAGE', link: null },
          { name: 'audio', type: 'AUDIO', link: null },
          { name: 'mode', type: 'STRING', link: null },
          { name: 'face_detect_batch', type: 'INT', link: null },
          { name: 'on_no_face', type: 'STRING', link: null },
        ],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [], slot_index: 0 }],
        widgets: ['sequential', 8, 'passthrough'],
        order: 3,
      });

      const saveImage = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'SaveImage',
        pos: [360, 40],
        size: [250, 140],
        inputs: [
          { name: 'images', type: 'IMAGE', link: null },
          { name: 'filename_prefix', type: 'STRING', link: null },
        ],
        widgets: ['vidax_export'],
        order: 4,
      });

      createLink(loadImage, 0, repeatBatch, 0, 'IMAGE');
      createLink(repeatBatch, 0, wav2lip, 0, 'IMAGE');
      createLink(loadAudio, 0, wav2lip, 1, 'AUDIO');
      createLink(wav2lip, 0, saveImage, 0, 'IMAGE');

      saveImage.inputs[1].link = null;
      saveImage.inputs[1].default = 'vidax_export';

      nodes.push(loadImage, repeatBatch, loadAudio, wav2lip, saveImage);
    } else {
      const repeatBatch = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'RepeatImageBatch',
        pos: [-340, -40],
        size: [220, 170],
        inputs: [
          { name: 'image', type: 'IMAGE', link: null },
          { name: 'amount', type: 'INT', link: null, default: 25 },
        ],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [], slot_index: 0 }],
        widgets: [25],
        order: 1,
      });

      const saveImage = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'SaveImage',
        pos: [40, -40],
        size: [250, 140],
        inputs: [
          { name: 'images', type: 'IMAGE', link: null },
          { name: 'filename_prefix', type: 'STRING', link: null },
        ],
        widgets: ['vidax_export'],
        order: 2,
      });

      createLink(loadImage, 0, repeatBatch, 0, 'IMAGE');
      createLink(repeatBatch, 0, saveImage, 0, 'IMAGE');

      saveImage.inputs[1].link = null;
      saveImage.inputs[1].default = 'vidax_export';

      nodes.push(loadImage, repeatBatch, saveImage);
    }
  } else {
    const loadVideo = buildUiWorkflowNode({
      id: nextNodeId++,
      type: 'VHS_LoadVideo',
      pos: [-600, -40],
      size: [240, 180],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [], slot_index: 0 }],
      widgets: ['', 'video', 25, 0, 0, 'Custom', 854, 480],
    });

    if (lipsyncEnabled) {
      const loadAudio = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'LoadAudio',
        pos: [-600, 200],
        size: [220, 120],
        outputs: [{ name: 'AUDIO', type: 'AUDIO', links: [], slot_index: 0 }],
        widgets: [''],
        order: 1,
      });

      const wav2lip = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'VIDAX_Wav2Lip',
        pos: [-280, 80],
        size: [320, 200],
        inputs: [
          { name: 'images', type: 'IMAGE', link: null },
          { name: 'audio', type: 'AUDIO', link: null },
          { name: 'mode', type: 'STRING', link: null },
          { name: 'face_detect_batch', type: 'INT', link: null },
          { name: 'on_no_face', type: 'STRING', link: null },
        ],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [], slot_index: 0 }],
        widgets: ['sequential', 8, 'passthrough'],
        order: 2,
      });

      const saveImage = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'SaveImage',
        pos: [80, 80],
        size: [250, 140],
        inputs: [
          { name: 'images', type: 'IMAGE', link: null },
          { name: 'filename_prefix', type: 'STRING', link: null },
        ],
        widgets: ['vidax_export'],
        order: 3,
      });

      createLink(loadVideo, 0, wav2lip, 0, 'IMAGE');
      createLink(loadAudio, 0, wav2lip, 1, 'AUDIO');
      createLink(wav2lip, 0, saveImage, 0, 'IMAGE');

      saveImage.inputs[1].link = null;
      saveImage.inputs[1].default = 'vidax_export';

      nodes.push(loadVideo, loadAudio, wav2lip, saveImage);
    } else {
      const saveImage = buildUiWorkflowNode({
        id: nextNodeId++,
        type: 'SaveImage',
        pos: [-280, -20],
        size: [250, 140],
        inputs: [
          { name: 'images', type: 'IMAGE', link: null },
          { name: 'filename_prefix', type: 'STRING', link: null },
        ],
        widgets: ['vidax_export'],
        order: 1,
      });

      createLink(loadVideo, 0, saveImage, 0, 'IMAGE');

      saveImage.inputs[1].link = null;
      saveImage.inputs[1].default = 'vidax_export';

      nodes.push(loadVideo, saveImage);
    }
  }

  const lastNodeId = nodes.reduce((maxId, node) => Math.max(maxId, node.id), 0) || 0;
  const lastLinkId = links.reduce((maxId, link) => Math.max(maxId, link[0]), 0) || 0;

  return {
    last_node_id: lastNodeId,
    last_link_id: lastLinkId,
    nodes,
    links,
    groups: [],
    config: {},
    extra: {},
    version: 1,
  };
}

function buildVidaxWav2LipImagePrompt(options = {}) {
  const frameCount = asPositiveInt(options.frameCount, 1) || 1;
  const fps = asPositiveInt(options.fps, 25) || 25;
  const startImageName = options.startImageName;
  const audioName = options.audioName;
  const wav2lipMode = normalizeWav2LipMode(options.wav2lipMode);
  const faceDetectBatch = asPositiveInt(options.faceDetectBatch, 8) || 8;
  const filenamePrefix =
    options.outputPrefix || options.filenamePrefix || options.output_prefix || options.workdirPrefix || 'vidax_wav2lip';
  const onNoFace = options.onNoFace || options.on_no_face || 'passthrough';

  return {
    prompt: {
      1: {
        class_type: 'LoadImage',
        inputs: { image: startImageName },
      },
      2: {
        class_type: 'RepeatImageBatch',
        inputs: {
          image: ['1', 0],
          amount: frameCount,
        },
      },
      3: {
        class_type: 'LoadAudio',
        inputs: { audio: audioName },
      },
      4: {
        class_type: 'VIDAX_Wav2Lip',
        inputs: {
          images: ['2', 0],
          audio: ['3', 0],
          mode: wav2lipMode,
          face_detect_batch: faceDetectBatch,
          on_no_face: onNoFace,
        },
      },
      5: {
        class_type: 'SaveImage',
        inputs: { images: ['4', 0], filename_prefix: filenamePrefix },
      },
    },
  };
}

function buildVidaxWav2LipVideoPrompt(options = {}) {
  const frameCount = asPositiveInt(options.frameCount, 1) || 1;
  const fps = asPositiveInt(options.fps, 25) || 25;
  const width = asPositiveInt(options.width, 854) || 854;
  const height = asPositiveInt(options.height, 480) || 480;
  const startVideoName = options.startVideoName;
  const audioName = options.audioName;
  const wav2lipMode = normalizeWav2LipMode(options.wav2lipMode);
  const faceDetectBatch = asPositiveInt(options.faceDetectBatch, 8) || 8;
  const filenamePrefix =
    options.outputPrefix || options.filenamePrefix || options.output_prefix || options.workdirPrefix || 'vidax_wav2lip';
  const onNoFace = options.onNoFace || options.on_no_face || 'passthrough';

  return {
    prompt: {
      1: {
        class_type: 'VHS_LoadVideo',
        inputs: {
          video: startVideoName,
          force_rate: fps,
          frame_load_cap: frameCount,
          force_size: 'Custom',
          custom_width: width,
          custom_height: height,
        },
      },
      2: {
        class_type: 'LoadAudio',
        inputs: { audio: audioName },
      },
      3: {
        class_type: 'VIDAX_Wav2Lip',
        inputs: {
          images: ['1', 0],
          audio: ['2', 0],
          mode: wav2lipMode,
          face_detect_batch: faceDetectBatch,
          on_no_face: onNoFace,
        },
      },
      4: {
        class_type: 'SaveImage',
        inputs: { images: ['3', 0], filename_prefix: filenamePrefix },
      },
    },
  };
}

function buildVidaxFaceProbePrompt(options = {}) {
  const startImageName = options.startImageName;
  const angles = Array.isArray(options.angles) && options.angles.length ? options.angles : [];
  const paddedAngles = angles.length ? angles : Array.from({ length: 13 }, (_, idx) => -30 + idx * 5);
  const filenamePrefix = options.outputPrefix || 'vidax_faceprobe';
  return {
    prompt: {
      1: { class_type: 'LoadImage', inputs: { image: startImageName } },
      2: {
        class_type: 'SaveImage',
        inputs: { images: ['1', 0], filename_prefix: `${filenamePrefix}_crop` },
      },
      3: {
        class_type: 'SaveImage',
        inputs: { images: ['1', 0], filename_prefix: `${filenamePrefix}_debug` },
      },
      4: {
        class_type: 'SaveImage',
        inputs: { images: ['1', 0], filename_prefix: `${filenamePrefix}_meta` },
      },
    },
    meta: { angles: paddedAngles },
  };
}

function buildVidaxMotionChunksPrompt(options = {}) {
  const startImageName = options.startImageName;
  const frameCount = asPositiveInt(options.frameCount, 16) || 16;
  const fps = asPositiveNumber(options.fps, 8) || 8;
  const filenamePrefix = options.outputPrefix || 'vidax_motion';
  return {
    prompt: {
      1: { class_type: 'LoadImage', inputs: { image: startImageName } },
      2: {
        class_type: 'RepeatImageBatch',
        inputs: { image: ['1', 0], amount: frameCount },
      },
      3: {
        class_type: 'SaveImage',
        inputs: { images: ['2', 0], filename_prefix: filenamePrefix },
      },
    },
    meta: { fps, frame_count: frameCount },
  };
}

function buildVidaxLipsyncMouthBlendPrompt(options = {}) {
  const frameCount = asPositiveInt(options.frameCount, 16) || 16;
  const fps = asPositiveNumber(options.fps, 8) || 8;
  const audioName = options.audioName;
  const startImageName = options.startImageName;
  const filenamePrefix = options.outputPrefix || 'vidax_mouthblend';
  const wav2lipMode = normalizeWav2LipMode(options.wav2lipMode);
  const faceDetectBatch = asPositiveInt(options.faceDetectBatch, 8) || 8;
  const onNoFace = options.onNoFace || options.on_no_face || 'passthrough';
  return {
    prompt: {
      1: { class_type: 'LoadImage', inputs: { image: startImageName } },
      2: {
        class_type: 'RepeatImageBatch',
        inputs: { image: ['1', 0], amount: frameCount },
      },
      3: { class_type: 'LoadAudio', inputs: { audio: audioName } },
      4: {
        class_type: 'VIDAX_Wav2Lip',
        inputs: {
          images: ['2', 0],
          audio: ['3', 0],
          mode: wav2lipMode,
          face_detect_batch: faceDetectBatch,
          on_no_face: onNoFace,
        },
      },
      5: { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: filenamePrefix } },
    },
    meta: { fps, frame_count: frameCount },
  };
}

module.exports = {
  buildVidaxWav2LipImagePrompt,
  buildVidaxWav2LipVideoPrompt,
  buildVidaxFaceProbePrompt,
  buildVidaxMotionChunksPrompt,
  buildVidaxLipsyncMouthBlendPrompt,
  buildUiWorkflow,
};
