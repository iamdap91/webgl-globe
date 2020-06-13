
import * as THREE from './build/three.module.js';

import Stats from './libs/stats.module.js';

import { GUI } from './libs/dat.gui.module.js';
import { OrbitControls } from './controls/OrbitControls.js';
import { SVGLoader } from './loaders/SVGLoader.js';


const width = window.innerWidth;
const height = window.innerHeight;

// basic settings
let scene;
let renderer;
let camera;
let stats;
let controls;
let webglEl;

// meshes
const earthParam = {
    radius: 0.5,
    segments: 32,
    rotation: 0
}
let sphere;
let pickingSphere;
let clouds;
let svgMap;
let directionalLight;
let ambientLight;


// about picking
let numCountriesSelected = 0;
let countryInfos;
const settings = {
    minArea: 20,
    maxVisibleDot: -0.2,
};
const tempV = new THREE.Vector3();
const cameraToPoint = new THREE.Vector3();
const cameraPosition = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

let controlPanel = {
    cameraControls: {
        cloudRotationSpeed: 0.001,
        autoRotate: false,
    },
    surfaceControls: {
        bumpScale: 0.02,
        viewClouds: true,
        reverseColor: false,
    },
    lightControls: {
        pointLight: true,
        ambientLight: false
    },
    modeControls: {
        pickingMode: false,
        detailMode: false,
    }
}


// init webgl-container, scene, camera, renderer, OrbitControl, stats
async function init() {
    webglEl = document.getElementById('webgl');

    camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 500);
    camera.position.z = 2.5;

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);

    controls = new OrbitControls(camera, webglEl);
    {
        controls.enablePan = false;
        controls.maxDistance = 5;
        controls.minDistance = 1.5;
        // controls.cameraAutoRotation = cameraAutoRotation;
    }

    const container = document.querySelector('#webgl');
    stats = new Stats();
    container.appendChild(stats.dom);


    // init view that user sees. 
    scene = new THREE.Scene();
    webglEl.appendChild(renderer.domElement);


    ///////////////////
    await loadCountry();
    addLight();
    addMeshes();
    addPicking();
    createGUI();

    function render() {
        const cameraControls = controlPanel.cameraControls;
        if (cameraControls.autoRotate) {
            clouds.rotation.y -= cameraControls.cloudRotationSpeed;
        };
        controls.update();
        updateLabels();
        stats.update();

        requestAnimationFrame(render);
        renderer.render(scene, camera);
    }
    render();
}


function createGUI() {

    // dat.gui
    const gui = new GUI();

    const guiCamera = gui.addFolder('Camera');
    const guiSurface = gui.addFolder('Surface');
    const guiLight = gui.addFolder('Light');
    const guiMode = gui.addFolder('mode');

    // dat.gui controls object
    let cameraControls = controlPanel.cameraControls;
    guiCamera.add(cameraControls, 'cloudRotationSpeed', 0, 0.1).step(0.001).onChange((value) => cameraControls.cloudRotationSpeed = value);
    guiCamera.add(cameraControls, 'autoRotate').onChange((value) => {
        cameraControls.autoRotate = value;
        controls.enabled = !value;
    });
    // guiCamera.add(cameraControls, 'cameraPos', 1.5, 3.0).step(0.001).onChange((value) => camera.position.z = cameraPos = value);


    let surfaceControls = controlPanel.surfaceControls;
    guiSurface.add(surfaceControls, 'bumpScale', 0, 0.2).step(0.01).onChange((value) => {
        sphere.material.bumpScale = value;
        pickingSphere.material.bumpScale = value;
    });
    guiSurface.add(surfaceControls, 'viewClouds').onChange((value) => {
        clouds.material.opacity = value ? 1 : 0;
    });
    guiSurface.add(surfaceControls, 'reverseColor').onChange((value) => {
        sphere.material.map = (value) ? THREE.ImageUtils.loadTexture('images/2_no_clouds_4k_transparent.png') : THREE.ImageUtils.loadTexture('images/2_no_clouds_4k.jpg');
    });

    let lightControls = controlPanel.lightControls;
    guiLight.add(lightControls, 'pointLight').onChange((value) => {
        lightControls.pointLight = value;
        directionalLight.color = !value ? {
            r: 0,
            g: 0,
            b: 0
        } : {
                r: 1,
                g: 1,
                b: 1
            }
    });
    guiLight.add(lightControls, 'ambientLight').onChange((value) => {
        lightControls.ambientLight = value;
        ambientLight.color = !value ? {
            r: 0,
            g: 0,
            b: 0
        } : {
                r: 1,
                g: 1,
                b: 1
            }
    });

    const modeControls = controlPanel.modeControls;

    guiMode.add(modeControls, 'pickingMode').onChange((value) => {
        if (value) {
            sphere.position.z = 100;
            pickingSphere.position.z = 0;

            clouds.material.opacity = 0;
            surfaceControls.viewClouds = false;

        } else {
            sphere.position.z = 0;
            pickingSphere.position.z = 100;

            clouds.material.opacity = 1;
            surfaceControls.viewClouds = true;
        }
    });
    guiMode.add(modeControls, 'detailMode').onChange((value) => {
        svgMap.position.z = value ? 0 : 100;
    });

}

function updateLabels() {
    // exit if we have not loaded the data yet
    if (!countryInfos) {
        return;
    }

    const large = settings.minArea * settings.minArea;
    // get a matrix that represents a relative orientation of the camera
    normalMatrix.getNormalMatrix(camera.matrixWorldInverse);
    // get the camera's position
    camera.getWorldPosition(cameraPosition);
    for (const countryInfo of countryInfos) {
        const {
            position,
            elem,
            area,
            selected
        } = countryInfo;
        let largeEnough = area >= large;

        const show = selected || (numCountriesSelected === 0 && largeEnough);
        if (!show) {
            elem.style.display = 'none';
            continue;
        }

        // Orient the position based on the camera's orientation.
        // Since the sphere is at the origin and the sphere is a unit sphere
        // this gives us a camera relative direction vector for the position.
        tempV.copy(position);
        tempV.applyMatrix3(normalMatrix);

        // compute the direction to this position from the camera
        cameraToPoint.copy(position);
        cameraToPoint.applyMatrix4(camera.matrixWorldInverse).normalize();

        // get the dot product of camera relative direction to this position
        // on the globe with the direction from the camera to that point.
        // -1 = facing directly towards the camera
        // 0 = exactly on tangent of the sphere from the camera
        // > 0 = facing away
        const dot = tempV.dot(cameraToPoint);

        // if the orientation is not facing us hide it.
        if (dot > settings.maxVisibleDot) {
            elem.style.display = 'none';
            continue;
        }

        // restore the element to its default display style
        elem.style.display = '';


        // get the normalized screen coordinate of that position
        // x and y will be in the -1 to +1 range with x = -1 being
        // on the left and y = -1 being on the bottom
        tempV.copy(position);
        tempV.project(camera);

        // convert the normalized position to CSS coordinates
        const x = (tempV.x * .5 + .5) * webglEl.clientWidth;
        const y = (tempV.y * -.5 + .5) * webglEl.clientHeight;

        // move the elem to that position
        elem.style.transform = `translate(-50%, -50%) translate(${x}px,${y}px)`;

        // set the zIndex for sorting
        elem.style.zIndex = (-tempV.z * .5 + .5) * 100000 | 0;
    }

}

async function loadCountryData() {
    countryInfos = await loadJSON('https://threejsfundamentals.org/threejs/resources/data/world/country-info.json');

    const lonFudge = Math.PI * 1.5;
    const latFudge = Math.PI;
    // these helpers will make it easy to position the boxes
    // We can rotate the lon helper on its Y axis to the longitude
    const lonHelper = new THREE.Object3D();
    // We rotate the latHelper on its X axis to the latitude
    const latHelper = new THREE.Object3D();
    lonHelper.add(latHelper);
    // The position helper moves the object to the edge of the sphere
    const positionHelper = new THREE.Object3D();
    positionHelper.position.z = earthParam.radius;
    latHelper.add(positionHelper);

    const labelParentElem = document.querySelector('#labels');
    for (const countryInfo of countryInfos) {
        const {
            lat,
            lon,
            min,
            max,
            name
        } = countryInfo;

        // adjust the helpers to point to the latitude and longitude
        lonHelper.rotation.y = THREE.Math.degToRad(lon) + lonFudge;
        latHelper.rotation.x = THREE.Math.degToRad(lat) + latFudge;

        // get the position of the lat/lon
        positionHelper.updateWorldMatrix(true, false);
        const position = new THREE.Vector3();
        positionHelper.getWorldPosition(position);
        countryInfo.position = position;

        // compute the area for each country
        const width = max[0] - min[0];
        const height = max[1] - min[1];
        const area = width * height;
        countryInfo.area = area;

        // add an element for each country
        const elem = document.createElement('div');
        elem.textContent = name;
        labelParentElem.appendChild(elem);
        countryInfo.elem = elem;
    }
}

async function loadJSON(url) {
    const req = await fetch(url);
    return req.json();
}

async function loadCountry() {
    await loadCountryData();
    console.log(countryInfos);
}

function addPicking() {
    const pickingScene = new THREE.Scene();
    pickingScene.background = new THREE.Color(0);

    const tempColor = new THREE.Color();

    const maxNumCountries = 512;
    const paletteTextureWidth = maxNumCountries;
    const paletteTextureHeight = 1;
    const palette = new Uint8Array(paletteTextureWidth * 3);
    const paletteTexture = new THREE.DataTexture(palette, paletteTextureWidth, paletteTextureHeight, THREE.RGBFormat);
    paletteTexture.minFilter = THREE.NearestFilter;
    paletteTexture.magFilter = THREE.NearestFilter;

    const selectedColor = get255BasedColor('#ffffff');
    const unselectedColor = get255BasedColor('#000000');
    const oceanColor = get255BasedColor('#222222');
    resetPalette();

    function setPaletteColor(index, color) {
        palette.set(color, index * 3);
    }

    function resetPalette() {
        // make all colors the unselected color
        for (let i = 1; i < maxNumCountries; ++i) {
            setPaletteColor(i, unselectedColor);
        }

        // set the ocean color (index #0)
        setPaletteColor(0, oceanColor);
        paletteTexture.needsUpdate = true;
    }

    function get255BasedColor(color) {
        tempColor.set(color);
        return tempColor.toArray().map(v => v * 255);
    }
    ////////////////
    class GPUPickHelper {
        constructor() {
            // create a 1x1 pixel render target
            this.pickingTexture = new THREE.WebGLRenderTarget(1, 1);
            this.pixelBuffer = new Uint8Array(4);
        }
        pick(cssPosition, scene, camera) {
            const {
                pickingTexture,
                pixelBuffer
            } = this;

            // set the view offset to represent just a single pixel under the mouse
            const pixelRatio = renderer.getPixelRatio();
            camera.setViewOffset(
                renderer.getContext().drawingBufferWidth, // full width
                renderer.getContext().drawingBufferHeight, // full top
                cssPosition.x * pixelRatio | 0, // rect x
                cssPosition.y * pixelRatio | 0, // rect y
                1, // rect width
                1, // rect height
            );
            // render the scene
            renderer.setRenderTarget(pickingTexture);
            renderer.render(scene, camera);
            renderer.setRenderTarget(null);
            // clear the view offset so rendering returns to normal
            camera.clearViewOffset();
            //read the pixel
            renderer.readRenderTargetPixels(
                pickingTexture,
                0, // x
                0, // y
                1, // width
                1, // height
                pixelBuffer);

            const id =
                (pixelBuffer[0] << 0) |
                (pixelBuffer[1] << 8) |
                (pixelBuffer[2] << 16);

            return id;
        }
    }

    const pickHelper = new GPUPickHelper();
    const maxClickTimeMs = 200;
    const maxMoveDeltaSq = 5 * 5;
    const startPosition = {};
    let startTimeMs;

    {
        // picking
        const loader = new THREE.TextureLoader();
        const geometry = new THREE.SphereBufferGeometry(earthParam.radius, 64, 32);

        const indexTexture = loader.load('https://threejsfundamentals.org/threejs/resources/data/world/country-index-texture.png');
        indexTexture.minFilter = THREE.NearestFilter;
        indexTexture.magFilter = THREE.NearestFilter;

        const pickingMaterial = new THREE.MeshBasicMaterial({
            map: indexTexture
        });
        pickingScene.add(new THREE.Mesh(geometry, pickingMaterial));

        // actual drawing globe
        const fragmentShaderReplacements = [{
            from: '#include <common>',
            to: `
              #include <common>
              uniform sampler2D indexTexture;
              uniform sampler2D paletteTexture;
              uniform float paletteTextureWidth;
            `,
        },
        {
            from: '#include <color_fragment>',
            to: `
              #include <color_fragment>
              {
                vec4 indexColor = texture2D(indexTexture, vUv);
                float index = indexColor.r * 255.0 + indexColor.g * 255.0 * 256.0;
                vec2 paletteUV = vec2((index + 0.5) / paletteTextureWidth, 0.5);
                vec4 paletteColor = texture2D(paletteTexture, paletteUV);
                diffuseColor.rgb += paletteColor.rgb;   // white outlines
                // diffuseColor.rgb = paletteColor.rgb - diffuseColor.rgb;  // black outlines
              }
            `,
        },
        ];

        const texture = loader.load('https://threejsfundamentals.org/threejs/resources/data/world/country-outlines-4k.png');
        // const texture = loader.load('images/2_no_clouds_4k_bnk.png');
        const bumpMap = THREE.ImageUtils.loadTexture('images/elev_bump_4k.jpg');
        const specularMap = THREE.ImageUtils.loadTexture('images/water_4k.png');
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            bumpMap,
            bumpScale: 0.02,
            specularMap,
            specular: new THREE.Color('grey')
        });
        material.onBeforeCompile = function (shader) {
            fragmentShaderReplacements.forEach((rep) => {
                shader.fragmentShader = shader.fragmentShader.replace(rep.from, rep.to);
            });
            shader.uniforms.paletteTexture = {
                value: paletteTexture
            };
            shader.uniforms.indexTexture = {
                value: indexTexture
            };
            shader.uniforms.paletteTextureWidth = {
                value: paletteTextureWidth
            };
        };
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'pickingMesh';
        pickingSphere = mesh;
        pickingSphere.position.z = 100;
        scene.add(mesh);
    }

    webglEl.addEventListener('mousedown', recordStartTimeAndPosition);
    webglEl.addEventListener('mouseup', pickCountry);


    function getCanvasRelativePosition(event) {
        const rect = webglEl.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * renderer.domElement.width / rect.width,
            y: (event.clientY - rect.top) * renderer.domElement.height / rect.height,
        };
    }

    function recordStartTimeAndPosition(event) {
        startTimeMs = performance.now();
        const pos = getCanvasRelativePosition(event);
        startPosition.x = pos.x;
        startPosition.y = pos.y;
    }

    function unselectAllCountries() {
        numCountriesSelected = 0;
        countryInfos.forEach((countryInfo) => {
            countryInfo.selected = false;
        });
        resetPalette();
    }

    function pickCountry(event) {
        // exit if we have not loaded the data yet
        if (!countryInfos) {
            return;
        }

        // if it's been a moment since the user started
        // then assume it was a drag action, not a select action
        const clickTimeMs = performance.now() - startTimeMs;
        if (clickTimeMs > maxClickTimeMs) {
            return;
        }

        // if they moved assume it was a drag action
        const position = getCanvasRelativePosition(event);
        const moveDeltaSq = (startPosition.x - position.x) ** 2 +
            (startPosition.y - position.y) ** 2;
        if (moveDeltaSq > maxMoveDeltaSq) {
            return;
        }

        const id = pickHelper.pick(position, pickingScene, camera);
        console.log(id);
        if (id > 0) {
            const countryInfo = countryInfos[id - 1];
            const selected = !countryInfo.selected;
            if (selected && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                unselectAllCountries();
            }
            numCountriesSelected += selected ? 1 : -1;
            countryInfo.selected = selected;
            setPaletteColor(id, selected ? selectedColor : unselectedColor);
            paletteTexture.needsUpdate = true;
        } else if (numCountriesSelected) {
            unselectAllCountries();
        }
        // requestRenderIfNotRequested();
    }


}

function addLight() {
    ambientLight = new THREE.AmbientLight(0x000000);
    scene.add(ambientLight);
    directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 3, 5);
    scene.add(directionalLight);
}

function addMeshes() {
    sphere = createSphere(earthParam.radius, earthParam.segments);
    clouds = createClouds(earthParam.radius, earthParam.segments);
    const stars = createStars(90, 64);

    scene.add(sphere);
    scene.add(clouds);
    scene.add(stars);

}

function createSphere(radius, segments) { //earth
    return new THREE.Mesh(
        new THREE.SphereGeometry(radius, segments, segments),
        new THREE.MeshPhongMaterial({
            transparent: true,
            color: '#ffffff',
            map: THREE.ImageUtils.loadTexture('images/2_no_clouds_4k.jpg'),
            bumpMap: THREE.ImageUtils.loadTexture('images/elev_bump_4k.jpg'),
            bumpScale: 0.02,
            specularMap: THREE.ImageUtils.loadTexture('images/water_4k.png'),
            specular: new THREE.Color('grey')
        })
    );
}

function createClouds(radius, segments) { //cloud
    return new THREE.Mesh(
        new THREE.SphereGeometry(radius + 0.003, segments, segments),
        new THREE.MeshPhongMaterial({
            map: THREE.ImageUtils.loadTexture('images/fair_clouds_4k.png'),
            transparent: true
        })
    );
}

function createStars(radius, segments) {
    return new THREE.Mesh(
        new THREE.SphereGeometry(radius, segments, segments),
        new THREE.MeshBasicMaterial({
            map: THREE.ImageUtils.loadTexture('images/galaxy_starfield.png'),
            side: THREE.BackSide
        })
    );
}

function loadSVG(url) {

    //

    // const scene = new THREE.Scene();
    // scene.background = new THREE.Color(0xb0b0b0);

    //

    // var helper = new THREE.GridHelper(160, 10);
    // helper.rotation.x = Math.PI / 2;
    // scene.add(helper);

    //

    var loader = new SVGLoader();

    loader.load(url, function (data) {

        var paths = data.paths;

        var group = new THREE.Group();
        // group.scale.multiplyScalar(0.25);
        group.scale.multiplyScalar(0.001);
        
        // group.position.x = -70;
        // group.position.y = 70;
        group.position.x = 0.7;
        group.position.y = 0.35;
        
        group.scale.y *= -1;

        for (var i = 0; i < paths.length; i++) {

            var path = paths[i];

            var fillColor = path.userData.style.fill;
            if (guiData.drawFillShapes && fillColor !== undefined && fillColor !== 'none') {

                var material = new THREE.MeshBasicMaterial({
                    color: new THREE.Color().setStyle(fillColor),
                    opacity: path.userData.style.fillOpacity,
                    transparent: path.userData.style.fillOpacity < 1,
                    side: THREE.DoubleSide,
                    depthWrite: true,
                    wireframe: guiData.fillShapesWireframe
                });

                var shapes = path.toShapes(true);

                for (var j = 0; j < shapes.length; j++) {

                    var shape = shapes[j];

                    var geometry = new THREE.ExtrudeBufferGeometry(shape, {depth : -100});
                    var mesh = new THREE.Mesh(geometry, material);

                    group.add(mesh);

                }

            }

            var strokeColor = path.userData.style.stroke;

            if (guiData.drawStrokes && strokeColor !== undefined && strokeColor !== 'none') {

                var material = new THREE.MeshBasicMaterial({
                    color: new THREE.Color().setStyle(strokeColor),
                    opacity: path.userData.style.strokeOpacity,
                    transparent: path.userData.style.strokeOpacity < 1,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    wireframe: guiData.strokesWireframe
                });

                for (var j = 0, jl = path.subPaths.length; j < jl; j++) {

                    var subPath = path.subPaths[j];

                    var geometry = SVGLoader.pointsToStroke(subPath.getPoints(), path.userData.style);

                    if (geometry) {

                        var mesh = new THREE.Mesh(geometry, material);

                        group.add(mesh);

                    }

                }

            }

        }
        console.log(group);

        scene.add(group);
        svgMap = group;
        svgMap.position.z = 100;
    });

}

init();

const guiData = {
    currentURL: 'models/svg/tiger.svg',
    drawFillShapes: true,
    drawStrokes: true,
    fillShapesWireframe: false,
    strokesWireframe: true
};
loadSVG('../images/svg/korea.svg');

